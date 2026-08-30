const express = require("express");
const { getPool } = require("./db");
const { getBookingConfig } = require("./config");
const {
  BookingError,
  calculateAvailability,
  createBookingRequest,
  listActiveServices,
  publicService
} = require("./service");
const {
  addDays,
  localDateForInstant,
  parseDateOnly
} = require("./time");
const {
  isTestFixtureEmail,
  sendNewRequestAdminEmail,
  sendRequestReceivedEmail
} = require("./email");

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendBookingError(error, res) {
  if (error instanceof BookingError) {
    return res.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message
    });
  }
  console.error("Booking API failed:", error?.message || error);
  return res.status(503).json({
    ok: false,
    code: "booking_unavailable",
    error: "The booking service is temporarily unavailable."
  });
}

router.get("/services", asyncRoute(async (req, res) => {
  try {
    const services = await listActiveServices(getPool());
    res.json({ ok: true, services: services.map(publicService) });
  } catch (error) {
    sendBookingError(error, res);
  }
}));

router.get("/availability", asyncRoute(async (req, res) => {
  try {
    const config = getBookingConfig();
    const now = new Date();
    const today = localDateForInstant(now, config.timezone);
    const fromDate = req.query.from ? String(req.query.from) : today;
    const toDate = req.query.to
      ? String(req.query.to)
      : addDays(fromDate, config.bookingHorizonDays);

    if (!parseDateOnly(fromDate) || !parseDateOnly(toDate)) {
      throw new BookingError("Use ISO dates in YYYY-MM-DD format.", 400, "invalid_date");
    }

    const availability = await calculateAvailability({
      client: getPool(),
      serviceIdentifier: req.query.service,
      fromDate,
      toDate,
      config
    });
    res.json({
      ok: true,
      timezone: availability.timezone,
      service: publicService(availability.service),
      dates: availability.dates
    });
  } catch (error) {
    sendBookingError(error, res);
  }
}));

router.post("/requests", asyncRoute(async (req, res) => {
  try {
    const result = await createBookingRequest({
      pool: getPool(),
      input: req.body
    });
    const booking = result;
    const suppressEmail = isTestFixtureEmail(booking.clientEmail);
    Promise.resolve()
      .then(() => sendRequestReceivedEmail({ booking, token: booking.actionToken, suppress: suppressEmail }))
      .catch(error => console.error("Booking request email failed:", error.message));
    Promise.resolve()
      .then(() => sendNewRequestAdminEmail({ booking, suppress: suppressEmail }))
      .catch(error => console.error("Booking admin notification failed:", error.message));
    res.status(201).json({
      ok: true,
      status: booking.status,
      message: "Your booking request has been received and is pending confirmation."
    });
  } catch (error) {
    sendBookingError(error, res);
  }
}));

module.exports = {
  bookingRouter: router
};