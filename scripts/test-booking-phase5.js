const assert = require("assert");
const { getPool, closePool } = require("../booking/db");
const { addDays, localDateForInstant, localDateTimeToDate, weekdayForDateOnly } = require("../booking/time");
const {
  createBlockedTime,
  createRule,
  createService,
  updateAppointment
} = require("../booking/admin-service");
const {
  BookingError,
  calculateAvailability,
  createBookingRequest
} = require("../booking/service");
const {
  acceptAlternative,
  cancelByToken,
  cancelAppointment,
  confirmAppointment,
  declineAlternative,
  getClientAction,
  suggestAlternative
} = require("../booking/workflow-service");
const { getEmailConfiguration, sendCancelledEmail } = require("../booking/email");

if (process.env.NODE_ENV === "production") {
  throw new Error("Phase 5 integration tests use the development database.");
}

const tag = `phase5-test-${Date.now()}`;
const config = {
  timezone: "Europe/Stockholm",
  minimumNoticeHours: 0,
  bookingHorizonDays: 45,
  pendingExpirationHours: 24,
  slotIntervalMinutes: 15
};

function assertBookingError(error, code) {
  return error instanceof BookingError && error.code === code;
}

async function main() {
  const pool = getPool();
  const cleanup = { serviceIds: [], ruleIds: [], blockIds: [] };
  const now = new Date();
  const baseDate = localDateForInstant(now, config.timezone);

  try {
    const service = await createService(pool, {
      name: `Phase 5 ${tag}`,
      description: "temporary workflow fixture",
      durationMinutes: 60,
      defaultBreakMinutes: 15,
      displayOrder: 9999,
      active: true
    });
    cleanup.serviceIds.push(service.id);

    async function prepareDay(offset) {
      const date = addDays(baseDate, offset);
      const rule = await createRule(pool, {
        weekday: weekdayForDateOnly(date),
        start: "08:00",
        end: "18:00",
        effectiveFrom: date,
        effectiveUntil: date,
        active: true
      });
      cleanup.ruleIds.push(rule.id);
      return date;
    }

    async function makeBooking(date, time, label) {
      return createBookingRequest({
        pool,
        now,
        config,
        input: {
          service: service.id,
          startAt: localDateTimeToDate(date, time, config.timezone).toISOString(),
          clientName: `Phase 5 ${label}`,
          email: `${tag}-${label}@example.test`,
          phone: "0700000000"
        }
      });
    }

    const confirmedDate = await prepareDay(5);
    const pendingToConfirm = await makeBooking(confirmedDate, "09:00", "confirm");
    const confirmed = await confirmAppointment(pool, await appointmentId(pool, pendingToConfirm.clientEmail), config);
    assert.strictEqual(confirmed.booking.status, "confirmed");
    assert.strictEqual((await getClientAction(pool, confirmed.actionToken, config)).status, "confirmed");

    const cancelledDate = await prepareDay(6);
    const pendingToCancel = await makeBooking(cancelledDate, "09:00", "cancel");
    const cancelledId = await appointmentId(pool, pendingToCancel.clientEmail);
    const cancelled = await cancelAppointment(pool, cancelledId, config);
    assert.strictEqual(cancelled.booking.status, "cancelled");
    const availableAfterCancel = await calculateAvailability({
      client: pool,
      serviceIdentifier: service.id,
      fromDate: cancelledDate,
      toDate: cancelledDate,
      now,
      config
    });
    assert(
      availableAfterCancel.dates.some(date => date.times.some(time => time.localTime === "09:00")),
      "Cancelled appointments should no longer block availability."
    );
    const reopenedPending = await updateAppointment(pool, cancelledId, { status: "pending" }, config);
    assert.strictEqual(reopenedPending.status, "pending");
    assert.strictEqual(reopenedPending.breakMinutesOverride, null);
    await cancelAppointment(pool, cancelledId, config);
    const reopened = await confirmAppointment(pool, cancelledId, config);
    assert.strictEqual(reopened.booking.status, "confirmed");
    const unavailableAfterReopen = await calculateAvailability({
      client: pool,
      serviceIdentifier: service.id,
      fromDate: cancelledDate,
      toDate: cancelledDate,
      now,
      config
    });
    assert(
      !unavailableAfterReopen.dates.some(date => date.times.some(time => time.localTime === "09:00")),
      "Reconfirmed appointments should block availability again."
    );

    const acceptedDate = await prepareDay(7);
    const pendingToAccept = await makeBooking(acceptedDate, "09:00", "accept");
    const acceptedId = await appointmentId(pool, pendingToAccept.clientEmail);
    const emptyBreak = await updateAppointment(pool, acceptedId, {
      date: acceptedDate,
      start: "09:00",
      breakMinutesOverride: "",
      status: "pending"
    }, config);
    assert.strictEqual(emptyBreak.breakMinutesOverride, null);
    const zeroBreak = await updateAppointment(pool, acceptedId, {
      date: acceptedDate,
      start: "09:00",
      breakMinutesOverride: 0,
      status: "pending"
    }, config);
    assert.strictEqual(zeroBreak.breakMinutesOverride, 0);
    await assert.rejects(
      updateAppointment(pool, acceptedId, {
        date: acceptedDate,
        start: "09:00",
        breakMinutesOverride: "not-a-number",
        status: "pending"
      }, config),
      error => assertBookingError(error, "invalid_input")
    );
    const alternative = await suggestAlternative(pool, acceptedId, {
      alternativeDate: acceptedDate,
      alternativeStart: "11:00"
    }, config);
    const offer = await getClientAction(pool, alternative.actionToken, config);
    assert.strictEqual(offer.status, "alternative_suggested");
    assert.strictEqual(offer.alternative.time, "11:00");
    const accepted = await acceptAlternative(pool, alternative.actionToken, config);
    assert.strictEqual(accepted.booking.status, "confirmed");
    assert.strictEqual((await getClientAction(pool, accepted.actionToken, config)).status, "confirmed");

    const effectiveBreakDate = await prepareDay(14);
    const pendingWithNoBreak = await makeBooking(effectiveBreakDate, "09:00", "effective-break");
    const noBreakId = await appointmentId(pool, pendingWithNoBreak.clientEmail);
    await updateAppointment(pool, noBreakId, {
      date: effectiveBreakDate,
      start: "09:00",
      breakMinutesOverride: 0,
      status: "pending"
    }, config);
    const nextAppointment = await makeBooking(effectiveBreakDate, "12:00", "effective-break-blocker");
    await confirmAppointment(pool, await appointmentId(pool, nextAppointment.clientEmail), config);
    const effectiveBreakOffer = await suggestAlternative(pool, noBreakId, {
      alternativeDate: effectiveBreakDate,
      alternativeStart: "11:00"
    }, config);
    assert.strictEqual(effectiveBreakOffer.booking.status, "alternative_suggested");
    await declineAlternative(pool, effectiveBreakOffer.actionToken, config);

    const declinedDate = await prepareDay(8);
    const pendingToDecline = await makeBooking(declinedDate, "09:00", "decline");
    const declinedId = await appointmentId(pool, pendingToDecline.clientEmail);
    const declinedOffer = await suggestAlternative(pool, declinedId, {
      alternativeDate: declinedDate,
      alternativeStart: "11:00"
    }, config);
    const declined = await declineAlternative(pool, declinedOffer.actionToken, config);
    assert.strictEqual(declined.booking.status, "cancelled");

    const unavailableDate = await prepareDay(9);
    const blocked = await createBlockedTime(pool, {
      date: unavailableDate,
      start: "11:00",
      end: "12:00",
      reason: "phase 5 fixture"
    });
    cleanup.blockIds.push(blocked.id);
    const pendingUnavailable = await makeBooking(unavailableDate, "09:00", "unavailable");
    const unavailableId = await appointmentId(pool, pendingUnavailable.clientEmail);
    await assert.rejects(
      suggestAlternative(pool, unavailableId, {
        alternativeDate: unavailableDate,
        alternativeStart: "11:00"
      }, config),
      error => assertBookingError(error, "slot_unavailable")
    );

    const takenDate = await prepareDay(13);
    await makeBooking(takenDate, "09:00", "taken");
    const takenAvailability = await calculateAvailability({
      client: pool,
      serviceIdentifier: service.id,
      fromDate: takenDate,
      toDate: takenDate,
      now,
      config
    });
    const takenDay = takenAvailability.dates.find(date => date.date === takenDate);
    assert(
      takenDay?.unavailableTimes?.some(time => time.localTime === "09:00" && time.reason === "booked"),
      "Taken appointment times should be returned as private booked slots."
    );
    assert(
      !takenDay?.times?.some(time => time.localTime === "09:00"),
      "Taken appointment times must not be returned as available slots."
    );

    const conflictDate = await prepareDay(10);
    const pendingConflict = await makeBooking(conflictDate, "09:00", "conflict");
    const conflictId = await appointmentId(pool, pendingConflict.clientEmail);
    const conflictOffer = await suggestAlternative(pool, conflictId, {
      alternativeDate: conflictDate,
      alternativeStart: "11:00"
    }, config);
    await makeBooking(conflictDate, "11:00", "conflict-taker");
    await assert.rejects(
      acceptAlternative(pool, conflictOffer.actionToken, config),
      error => assertBookingError(error, "slot_unavailable")
    );

    const expiredDate = await prepareDay(11);
    const expired = await makeBooking(expiredDate, "09:00", "expired");
    await pool.query(
      "UPDATE booking.appointments SET client_action_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE client_email = $1",
      [expired.clientEmail]
    );
    await assert.rejects(
      getClientAction(pool, expired.actionToken, config),
      error => assertBookingError(error, "token_expired")
    );
    await assert.rejects(
      getClientAction(pool, "invalid-token-that-is-long-enough-to-check", config),
      error => assertBookingError(error, "invalid_token")
    );

    const isolationDate = await prepareDay(12);
    const isolationA = await makeBooking(isolationDate, "09:00", "isolation-a");
    const isolationB = await makeBooking(isolationDate, "11:00", "isolation-b");
    await cancelByToken(pool, isolationA.actionToken, config);
    const isolationBState = await pool.query(
      "SELECT status FROM booking.appointments WHERE client_email = $1",
      [isolationB.clientEmail]
    );
    assert.strictEqual(isolationBState.rows[0].status, "pending");

    const fixtureEmail = await sendCancelledEmail({
      booking: {
        clientEmail: `${tag}-email@example.test`,
        serviceName: "Fixture",
        startsAt: new Date(),
        durationMinutes: 60
      }
    });
    assert.strictEqual(fixtureEmail.reason, "test_fixture");
    assert.strictEqual(getEmailConfiguration().configured, false);

    console.log("Booking Phase 5 checks passed: approval transitions, alternative offers, secure expiring tokens, conflict protection, token isolation, and test email suppression.");
  } finally {
    await pool.query("DELETE FROM booking.appointments WHERE client_email LIKE $1", [`${tag}-%`]).catch(() => {});
    await pool.query("DELETE FROM booking.blocked_times WHERE id = ANY($1::bigint[])", [
      cleanup.blockIds.map(Number)
    ]).catch(() => {});
    await pool.query("DELETE FROM booking.availability_rules WHERE id = ANY($1::bigint[])", [
      cleanup.ruleIds.map(Number)
    ]).catch(() => {});
    await pool.query("DELETE FROM booking.services WHERE id = ANY($1::bigint[])", [
      cleanup.serviceIds.map(Number)
    ]).catch(() => {});
    await closePool();
  }
}

async function appointmentId(pool, email) {
  const result = await pool.query(
    "SELECT id FROM booking.appointments WHERE client_email = $1 ORDER BY id DESC LIMIT 1",
    [email]
  );
  return result.rows[0].id;
}

main().catch(error => {
  console.error(`Booking Phase 5 test failed: ${error.message}`);
  process.exitCode = 1;
});