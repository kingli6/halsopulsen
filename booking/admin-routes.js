const express = require("express");
const { getPool } = require("./db");
const { getBookingConfig } = require("./config");
const {
  BookingError
} = require("./service");
const {
  calendarEvents,
  createBlockedTime,
  createOverride,
  createRule,
  createService,
  getAppointment,
  listAppointments,
  listBlockedTimes,
  listOverrides,
  listRules,
  listServices,
  updateAppointment,
  updateBlockedTime,
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
  isTestFixtureEmail,
  sendAlternativeEmail,
  sendCancelledEmail,
  sendConfirmedEmail
} = require("./email");

const router = express.Router();

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

router.patch("/appointments/:id", asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  if (req.body?.action === "suggest_alternative") {
    const result = await suggestAlternative(getPool(), id, req.body, getBookingConfig());
    sendAlternativeEmail({
      booking: result.booking,
      token: result.actionToken,
      suppress: isTestFixtureEmail(result.booking.clientEmail)
    }).catch(error => console.error("Alternative-time email failed:", error.message));
    return res.json({ ok: true, appointment: result.booking });
  }
  if (req.body?.status === "confirmed") {
    const result = await confirmAppointment(getPool(), id, getBookingConfig());
    sendConfirmedEmail({
      booking: result.booking,
      token: result.actionToken,
      suppress: isTestFixtureEmail(result.booking.clientEmail)
    }).catch(error => console.error("Booking confirmation email failed:", error.message));
    return res.json({ ok: true, appointment: result.booking });
  }
  if (req.body?.status === "cancelled") {
    const result = await cancelAppointment(getPool(), id, getBookingConfig());
    sendCancelledEmail({
      booking: result.booking,
      suppress: isTestFixtureEmail(result.booking.clientEmail)
    }).catch(error => console.error("Booking cancellation email failed:", error.message));
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