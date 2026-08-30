const assert = require("assert");
const { getPool, closePool } = require("../booking/db");
const { BookingError } = require("../booking/service");
const {
  createBlockedTime,
  createOverride,
  createRule,
  createService,
  getAppointment,
  listAppointments,
  updateAppointment,
  updateBlockedTime,
  updateOverride,
  updateRule,
  updateService
} = require("../booking/admin-service");

if (process.env.NODE_ENV === "production") {
  throw new Error("Admin booking integration tests use the development database.");
}

const tag = `admin-test-${Date.now()}`;
const fixtureDate = "2099-06-01";

async function main() {
  const pool = getPool();
  const cleanup = {
    serviceIds: [],
    ruleIds: [],
    overrideIds: [],
    blockIds: [],
    appointmentIds: []
  };

  try {
    const service = await createService(pool, {
      name: `Admin test ${tag}`,
      description: "temporary",
      durationMinutes: 45,
      defaultBreakMinutes: 10,
      displayOrder: 9999,
      active: true
    });
    cleanup.serviceIds.push(service.id);
    assert.strictEqual(service.durationMinutes, 45);

    const updatedService = await updateService(pool, service.id, {
      name: service.name,
      description: "updated",
      durationMinutes: 50,
      defaultBreakMinutes: 20,
      displayOrder: 9998,
      active: false
    });
    assert.strictEqual(updatedService.active, false);
    assert.strictEqual(updatedService.defaultBreakMinutes, 20);

    const rule = await createRule(pool, {
      weekday: 1,
      start: "09:00",
      end: "12:00",
      effectiveFrom: fixtureDate,
      effectiveUntil: "2099-06-30",
      active: true
    });
    cleanup.ruleIds.push(rule.id);
    const updatedRule = await updateRule(pool, rule.id, {
      weekday: 1,
      start: "10:00",
      end: "13:00",
      effectiveFrom: fixtureDate,
      effectiveUntil: "2099-06-30",
      active: false
    });
    assert.strictEqual(updatedRule.start, "10:00");
    assert.strictEqual(updatedRule.active, false);

    const override = await createOverride(pool, {
      date: fixtureDate,
      unavailable: false,
      start: "14:00",
      end: "16:00",
      reason: "temporary",
      active: true
    });
    cleanup.overrideIds.push(override.id);
    const updatedOverride = await updateOverride(pool, override.id, {
      date: fixtureDate,
      unavailable: true,
      reason: "closed",
      active: true
    });
    assert.strictEqual(updatedOverride.unavailable, true);
    assert.strictEqual(updatedOverride.start, null);

    const block = await createBlockedTime(pool, {
      date: fixtureDate,
      start: "12:00",
      end: "13:00",
      reason: "temporary block"
    });
    cleanup.blockIds.push(block.id);
    const updatedBlock = await updateBlockedTime(pool, block.id, {
      date: fixtureDate,
      start: "13:00",
      end: "14:00",
      reason: "updated block"
    });
    assert.strictEqual(updatedBlock.start, "13:00");

    const inserted = await pool.query(`
      INSERT INTO booking.appointments (
        service_id, client_name, client_email, starts_at, ends_at,
        original_starts_at, original_ends_at,
        break_minutes_override, status, notes
      )
      VALUES
        ($1, 'Admin test one', $2, NULL, NULL, '2099-06-01T08:00:00Z', '2099-06-01T08:50:00Z', NULL, 'pending', ''),
        ($1, 'Admin test two', $3, '2099-06-01T13:30:00Z', '2099-06-01T14:20:00Z', '2099-06-01T13:30:00Z', '2099-06-01T14:20:00Z', NULL, 'confirmed', '')
      RETURNING id
    `, [service.id, `${tag}-one@example.test`, `${tag}-two@example.test`]);
    cleanup.appointmentIds = inserted.rows.map(row => String(row.id));

    const appointment = await getAppointment(pool, cleanup.appointmentIds[0]);
    assert.strictEqual(appointment.status, "pending");
    assert.strictEqual(appointment.startAt, null);
    assert.strictEqual(appointment.originalStart, "10:00");
    assert.strictEqual(appointment.effectiveBreakMinutes, 20);
    const pendingAppointments = await listAppointments(pool, {
      from: fixtureDate,
      to: fixtureDate
    });
    assert(
      pendingAppointments.some(item => item.id === cleanup.appointmentIds[0]),
      "Unscheduled pending appointments should remain visible in date-filtered listings."
    );

    const moved = await updateAppointment(pool, cleanup.appointmentIds[0], {
      date: fixtureDate,
      start: "09:00",
      breakMinutesOverride: 0,
      status: "confirmed"
    });
    assert.strictEqual(moved.start, "09:00");
    assert.strictEqual(moved.breakMinutesOverride, 0);
    assert.strictEqual(moved.status, "confirmed");
    const released = await updateAppointment(pool, cleanup.appointmentIds[0], {
      status: "pending"
    });
    assert.strictEqual(released.startAt, null);
    assert.strictEqual(released.endAt, null);
    assert.strictEqual(released.status, "pending");
    const rescheduled = await updateAppointment(pool, cleanup.appointmentIds[0], {
      date: fixtureDate,
      start: "09:00",
      status: "confirmed"
    });
    assert.strictEqual(rescheduled.status, "confirmed");

    await assert.rejects(
      updateAppointment(pool, cleanup.appointmentIds[0], {
        date: fixtureDate,
        start: "13:30",
        status: "confirmed"
      }),
      error => error instanceof BookingError && error.code === "blocked_time"
    );

    const cancelled = await updateAppointment(pool, cleanup.appointmentIds[0], { status: "cancelled" });
    assert.strictEqual(cancelled.status, "cancelled");
    const completed = await updateAppointment(pool, cleanup.appointmentIds[1], { status: "completed" });
    assert.strictEqual(completed.status, "completed");

    const appointments = await listAppointments(pool, { from: fixtureDate, to: fixtureDate });
    assert(appointments.some(item => item.id === cleanup.appointmentIds[0]));
    assert(appointments.some(item => item.id === cleanup.appointmentIds[1]));
    console.log("Booking admin integration checks passed.");
  } finally {
    await pool.query("DELETE FROM booking.appointments WHERE id = ANY($1::bigint[])", [
      cleanup.appointmentIds.map(Number)
    ]).catch(() => {});
    await pool.query("DELETE FROM booking.blocked_times WHERE id = ANY($1::bigint[])", [
      cleanup.blockIds.map(Number)
    ]).catch(() => {});
    await pool.query("DELETE FROM booking.availability_overrides WHERE id = ANY($1::bigint[])", [
      cleanup.overrideIds.map(Number)
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

main().catch(error => {
  console.error(`Booking admin test failed: ${error.message}`);
  process.exitCode = 1;
});