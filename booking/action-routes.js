const express = require("express");
const { getPool } = require("./db");
const { BookingError } = require("./service");
const {
  acceptAlternative,
  cancelByToken,
  declineAlternative,
  getClientAction
} = require("./workflow-service");
const {
  isTestFixtureEmail,
  sendCancelledEmail,
  sendConfirmedEmail
} = require("./email");

const router = express.Router();

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch(error => {
    if (error instanceof BookingError) {
      return res.status(error.status).json({
        ok: false,
        code: error.code,
        error: error.message
      });
    }
    console.error("Booking client action failed:", error?.message || error);
    return res.status(503).json({
      ok: false,
      code: "booking_unavailable",
      error: "The booking service is temporarily unavailable."
    });
  });
}

function token(req) {
  return req.params.token;
}

function suppressFor(booking) {
  return isTestFixtureEmail(booking.clientEmail);
}

router.get("/:token", asyncRoute(async (req, res) => {
  res.json({ ok: true, booking: await getClientAction(getPool(), token(req)) });
}));

router.post("/:token/accept", asyncRoute(async (req, res) => {
  const result = await acceptAlternative(getPool(), token(req));
  sendConfirmedEmail({
    booking: result.booking,
    token: result.actionToken,
    suppress: suppressFor(result.booking)
  }).catch(error => console.error("Booking confirmation email failed:", error.message));
  res.json({ ok: true, status: result.booking.status, manageToken: result.actionToken });
}));

router.post("/:token/decline", asyncRoute(async (req, res) => {
  const result = await declineAlternative(getPool(), token(req));
  sendCancelledEmail({
    booking: result.booking,
    suppress: suppressFor(result.booking)
  }).catch(error => console.error("Booking cancellation email failed:", error.message));
  res.json({ ok: true, status: result.booking.status });
}));

router.post("/:token/cancel", asyncRoute(async (req, res) => {
  const result = await cancelByToken(getPool(), token(req));
  sendCancelledEmail({
    booking: result.booking,
    suppress: suppressFor(result.booking)
  }).catch(error => console.error("Booking cancellation email failed:", error.message));
  res.json({ ok: true, status: result.booking.status });
}));

module.exports = {
  bookingActionRouter: router
};