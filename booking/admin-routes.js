const express = require("express");
const { getPool } = require("./db");
const { getBookingConfig, loadBookingConfig } = require("./config");
const {
  BookingError
} = require("./service");
const {
  calendarEvents,
  createBlockedTime,
  createOverride,
  createRule,
  createService,
  deleteCancelledAppointment,
  getBookingSettings,
  getAppointment,
  listAppointments,
  listBlockedTimes,
  listOverrides,
  listRules,
  listServices,
  updateAppointment,
  updateConfirmedAppointment,
  updateBlockedTime,
  updateBookingSettings,
  updateOverride,
  updateRule,
  updateService
} = require("./admin-service");
const {
  cancelAppointment,
  confirmAppointment,
  suggestAlternative
} = require("./workflow-service");
const {
  calendarSequence,
  isTestFixtureEmail,
  sendAdminCancelledEmail,
  sendAdminConfirmedEmail,
  sendAdminRescheduledEmail,
  sendAlternativeEmail,
  sendCancelledEmail,
  sendConfirmedEmail,
  sendRescheduledEmail
} = require("./email");

const router = express.Router();
const MAX_PERSONAL_MESSAGE_LENGTH = 1000;

function personalMessageFromBody(body) {
  const message = String(body?.personalMessage || "").trim();
  if (message.length > MAX_PERSONAL_MESSAGE_LENGTH) {
    throw new BookingError(
      "Det personliga meddelandet får vara högst 1 000 tecken.",
      400,
      "invalid_personal_message"
    );
  }
  return message;
}

function parseId(value) {
  const id = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(id) || id < 1) {
    throw new BookingError("A valid record ID is required.", 400, "invalid_id");
  }
  return id;
}

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch(error => {
    if (error instanceof BookingError) {
      return res.status(error.status).json({
        ok: false,
        code: error.code,
        error: error.message
      });
    }
    console.error("Booking admin API failed:", error?.message || error);
    return res.status(503).json({
      ok: false,
      code: "booking_unavailable",
      error: "The booking service is temporarily unavailable."
    });
  });
}

router.get("/services", asyncRoute(async (req, res) => {
  res.json({ ok: true, services: await listServices(getPool()) });
}));

router.post("/services", asyncRoute(async (req, res) => {
  res.status(201).json({ ok: true, service: await createService(getPool(), req.body) });
}));

router.put("/services/:id", asyncRoute(async (req, res) => {
  res.json({ ok: true, service: await updateService(getPool(), parseId(req.params.id), req.body) });
}));

router.get("/hours", asyncRoute(async (req, res) => {
  res.json({ ok: true, rules: await listRules(getPool()) });
}));

router.post("/hours", asyncRoute(async (req, res) => {
  res.status(201).json({ ok: true, rule: await createRule(getPool(), req.body) });
}));

router.put("/hours/:id", asyncRoute(async (req, res) => {
  res.json({ ok: true, rule: await updateRule(getPool(), parseId(req.params.id), req.body) });
}));

router.delete("/hours/:id", asyncRoute(async (req, res) => {
  const result = await getPool().query("DELETE FROM booking.availability_rules WHERE id = $1 RETURNING id", [
    parseId(req.params.id)
  ]);
  if (result.rowCount === 0) throw new BookingError("Working-hours rule not found.", 404, "not_found");
  res.json({ ok: true });
}));

router.get("/overrides", asyncRoute(async (req, res) => {
  res.json({ ok: true, overrides: await listOverrides(getPool()) });
}));

router.post("/overrides", asyncRoute(async (req, res) => {
  res.status(201).json({ ok: true, override: await createOverride(getPool(), req.body) });
}));

router.put("/overrides/:id", asyncRoute(async (req, res) => {
  res.json({ ok: true, override: await updateOverride(getPool(), parseId(req.params.id), req.body) });
}));

router.delete("/overrides/:id", asyncRoute(async (req, res) => {
  const result = await getPool().query("DELETE FROM booking.availability_overrides WHERE id = $1 RETURNING id", [
    parseId(req.params.id)
  ]);
  if (result.rowCount === 0) throw new BookingError("Availability override not found.", 404, "not_found");
  res.json({ ok: true });
}));

router.get("/blocks", asyncRoute(async (req, res) => {
  res.json({ ok: true, blockedTimes: await listBlockedTimes(getPool()) });
}));

router.get("/settings", asyncRoute(async (req, res) => {
  res.json({ ok: true, settings: await getBookingSettings(getPool()) });
}));

router.put("/settings", asyncRoute(async (req, res) => {
  res.json({ ok: true, settings: await updateBookingSettings(getPool(), req.body) });
}));

router.post("/blocks", asyncRoute(async (req, res) => {
  res.status(201).json({ ok: true, blockedTime: await createBlockedTime(getPool(), req.body) });
}));

router.put("/blocks/:id", asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    blockedTime: await updateBlockedTime(getPool(), parseId(req.params.id), req.body)
  });
}));

router.delete("/blocks/:id", asyncRoute(async (req, res) => {
  const result = await getPool().query("DELETE FROM booking.blocked_times WHERE id = $1 RETURNING id", [
    parseId(req.params.id)
  ]);
  if (result.rowCount === 0) throw new BookingError("Blocked time not found.", 404, "not_found");
  res.json({ ok: true });
}));

router.get("/appointments", asyncRoute(async (req, res) => {
  res.json({ ok: true, appointments: await listAppointments(getPool(), req.query) });
}));

router.get("/appointments/:id", asyncRoute(async (req, res) => {
  res.json({ ok: true, appointment: await getAppointment(getPool(), parseId(req.params.id)) });
}));

router.delete("/appointments/:id", asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    appointment: await deleteCancelledAppointment(getPool(), parseId(req.params.id))
  });
}));

router.patch("/appointments/:id", asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  if (req.body?.action === "suggest_alternative") {
    const personalMessage = personalMessageFromBody(req.body);
    const result = await suggestAlternative(getPool(), id, req.body, await loadBookingConfig(getPool()));
    sendAlternativeEmail({
      booking: result.booking,
      token: result.actionToken,
      personalMessage,
      suppress: isTestFixtureEmail(result.booking.clientEmail)
    }).catch(error => console.error("Alternative-time email failed:", error.message));
    return res.json({ ok: true, appointment: result.booking });
  }
  if (req.body?.status === "confirmed") {
    const personalMessage = personalMessageFromBody(req.body);
    const existing = await getAppointment(getPool(), id, getBookingConfig());
    if (existing.status === "confirmed") {
      const appointment = await updateConfirmedAppointment(getPool(), id, req.body, await loadBookingConfig(getPool()));
      const sequence = calendarSequence(appointment);
      sendRescheduledEmail({
        booking: appointment,
        sequence,
        suppress: isTestFixtureEmail(appointment.email || appointment.clientEmail)
      }).catch(error => console.error("Booking reschedule email failed:", error.message));
      sendAdminRescheduledEmail({
        booking: appointment,
        sequence,
        suppress: isTestFixtureEmail(appointment.email || appointment.clientEmail)
      }).catch(error => console.error("Admin booking reschedule email failed:", error.message));
      return res.json({ ok: true, appointment });
    }
    const result = await confirmAppointment(getPool(), id, req.body, await loadBookingConfig(getPool()));
    sendConfirmedEmail({
      booking: result.booking,
      token: result.actionToken,
      personalMessage,
      suppress: isTestFixtureEmail(result.booking.clientEmail)
    }).catch(error => console.error("Booking confirmation email failed:", error.message));
    sendAdminConfirmedEmail({
      booking: result.booking,
      suppress: isTestFixtureEmail(result.booking.clientEmail)
    }).catch(error => console.error("Admin booking confirmation email failed:", error.message));
    return res.json({ ok: true, appointment: result.booking });
  }
  if (req.body?.status === "cancelled") {
    const result = await cancelAppointment(getPool(), id, await loadBookingConfig(getPool()));
    const sequence = calendarSequence(result.booking);
    sendCancelledEmail({
      booking: result.booking,
      sequence,
      suppress: isTestFixtureEmail(result.booking.clientEmail)
    }).catch(error => console.error("Booking cancellation email failed:", error.message));
    if (result.booking.startsAt && result.booking.endsAt) {
      sendAdminCancelledEmail({
        booking: result.booking,
        sequence,
        suppress: isTestFixtureEmail(result.booking.clientEmail)
      }).catch(error => console.error("Admin booking cancellation email failed:", error.message));
    }
    return res.json({ ok: true, appointment: result.booking });
  }
  res.json({
    ok: true,
    appointment: await updateAppointment(getPool(), id, req.body)
  });
}));

router.get("/calendar", asyncRoute(async (req, res) => {
  res.json({ ok: true, ...(await calendarEvents(getPool(), req.query)) });
}));

module.exports = {
  bookingAdminRouter: router
};