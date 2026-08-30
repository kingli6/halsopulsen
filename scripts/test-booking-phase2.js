const assert = require("assert");
const { getPool, closePool } = require("../booking/db");
const { getBookingConfig } = require("../booking/config");
const {
  BookingError,
  calculateAvailability,
  createBookingRequest,
  findService
} = require("../booking/service");
const {
  localDateTimeToDate,
  localTimeForInstant
} = require("../booking/time");

if (process.env.NODE_ENV !== "production") {
  throw new Error("Phase 2 integration tests must run with NODE_ENV=production.");
}

const config = getBookingConfig({
  minimumNoticeHours: 0,
  bookingHorizonDays: 40000,
  pendingExpirationHours: 24,
  slotIntervalMinutes: 15
});
const now = new Date("2099-01-01T00:00:00.000Z");
const fixtureTag = `phase2-${Date.now()}`;
const fixtureEmails = new Set();
const fixtureDates = {
  rulesFrom: "2099-01-01",
  rulesUntil: "2099-12-31",
  unavailable: "2099-01-06",
  partial: "2099-01-07",
  blocked: "2099-01-08",
  appointment: "2099-01-09",
  race: "2099-01-10"
};

function assertBookingError(action, expectedCode) {
  return action
    .then(() => {
      throw new Error(`Expected ${expectedCode} booking error.`);
    })
    .catch(error => {
      assert(error instanceof BookingError, `Expected BookingError, received ${error.name}.`);
      assert.strictEqual(error.code, expectedCode);
      return error;
    });
}

async function main() {
  const pool = getPool();
  const setupClient = await pool.connect();
  let inactiveServiceId;
  let ptServiceId;

  try {
    await setupClient.query("BEGIN");
    const pt = await setupClient.query("SELECT id FROM booking.services WHERE name = 'PT'");
    assert.strictEqual(pt.rowCount, 1, "PT seed service is required.");
    ptServiceId = pt.rows[0].id;

    const inactive = await setupClient.query(`
      INSERT INTO booking.services (
        name, description, duration_minutes, default_break_minutes, active, display_order
      )
      VALUES ($1, 'Phase 2 test service', 60, 15, false, 999)
      RETURNING id
    `, [`Phase 2 inactive ${fixtureTag}`]);
    inactiveServiceId = inactive.rows[0].id;

    await setupClient.query(`
      INSERT INTO booking.availability_rules (
        weekday, start_time, end_time, timezone, effective_from, effective_until
      )
      VALUES
        (1, '09:00', '12:00', 'Europe/Stockholm', $1, $2),
        (1, '13:00', '17:00', 'Europe/Stockholm', $1, $2),
        (2, '09:00', '17:00', 'Europe/Stockholm', $1, $2),
        (3, '09:00', '17:00', 'Europe/Stockholm', $1, $2),
        (4, '09:00', '17:00', 'Europe/Stockholm', $1, $2),
        (5, '09:00', '20:00', 'Europe/Stockholm', $1, $2),
        (6, '09:00', '17:00', 'Europe/Stockholm', $1, $2)
    `, [fixtureDates.rulesFrom, fixtureDates.rulesUntil]);

    await setupClient.query(`
      INSERT INTO booking.availability_overrides (
        override_date, timezone, is_unavailable, reason
      )
      VALUES ($1, 'Europe/Stockholm', true, $2)
    `, [fixtureDates.unavailable, fixtureTag]);
    await setupClient.query(`
      INSERT INTO booking.availability_overrides (
        override_date, start_time, end_time, timezone, is_unavailable, reason
      )
      VALUES ($1, '12:00', '15:00', 'Europe/Stockholm', false, $2)
    `, [fixtureDates.partial, fixtureTag]);

    await setupClient.query(`
      INSERT INTO booking.blocked_times (starts_at, ends_at, reason)
      VALUES ('2099-01-08T09:00:00Z', '2099-01-08T10:00:00Z', $1)
    `, [fixtureTag]);

    const fixtureAppointments = [
      {
        date: fixtureDates.appointment,
        start: "08:00:00Z",
        end: "09:00:00Z",
        override: 30,
        status: "confirmed",
        createdAt: "2098-12-31T12:00:00Z",
        email: `${fixtureTag}-confirmed@example.test`
      },
      {
        date: fixtureDates.appointment,
        start: "10:00:00Z",
        end: "11:00:00Z",
        override: null,
        status: "pending",
        createdAt: "2099-01-01T00:00:00Z",
        email: `${fixtureTag}-pending@example.test`
      },
      {
        date: fixtureDates.appointment,
        start: "16:00:00Z",
        end: "17:00:00Z",
        override: null,
        status: "pending",
        createdAt: "2020-12-30T00:00:00Z",
        email: `${fixtureTag}-expired@example.test`
      },
      {
        date: fixtureDates.appointment,
        start: "13:00:00Z",
        end: "14:00:00Z",
        override: 0,
        status: "confirmed",
        createdAt: "2099-01-01T00:00:00Z",
        email: `${fixtureTag}-zero@example.test`
      },
      {
        date: fixtureDates.appointment,
        start: "14:00:00Z",
        end: "15:00:00Z",
        override: 60,
        status: "confirmed",
        createdAt: "2099-01-01T00:00:00Z",
        email: `${fixtureTag}-long@example.test`
      }
    ];

    for (const appointment of fixtureAppointments) {
      fixtureEmails.add(appointment.email);
      const currentStart = appointment.status === "pending"
        ? null
        : `${appointment.date}T${appointment.start}`;
      const currentEnd = appointment.status === "pending"
        ? null
        : `${appointment.date}T${appointment.end}`;
      await setupClient.query(`
        INSERT INTO booking.appointments (
          service_id, client_name, client_email, starts_at, ends_at,
          original_starts_at, original_ends_at,
          break_minutes_override, status, notes, created_at
        )
        VALUES ($1, 'Phase 2 fixture', $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        ptServiceId,
        appointment.email,
        currentStart,
        currentEnd,
        `${appointment.date}T${appointment.start}`,
        `${appointment.date}T${appointment.end}`,
        appointment.override,
        appointment.status,
        fixtureTag,
        appointment.createdAt
      ]);
    }
    await setupClient.query("COMMIT");

    const findSlots = options => calculateAvailability({
      client: pool,
      serviceIdentifier: "PT",
      now,
      config,
      ...options
    });

    const monday = await findSlots({ fromDate: "2099-01-05", toDate: "2099-01-05" });
    assert(monday.dates.some(date => date.times.some(time => time.localTime === "09:00")), "Normal slot missing.");

    const outsideHours = await findSlots({ fromDate: "2099-01-05", toDate: "2099-01-05" });
    assert(!outsideHours.dates.some(date => date.times.some(time => time.localTime === "08:00")), "Outside-hours slot returned.");

    const unavailable = await findSlots({ fromDate: fixtureDates.unavailable, toDate: fixtureDates.unavailable });
    assert.strictEqual(unavailable.dates.length, 0, "Unavailable override should remove the date.");

    const partial = await findSlots({ fromDate: fixtureDates.partial, toDate: fixtureDates.partial });
    assert(partial.dates.some(date => date.times.some(time => time.localTime === "12:00")), "Partial override start missing.");
    assert(!partial.dates.some(date => date.times.some(time => time.localTime === "15:00")), "Partial override exceeded.");

    const blocked = await findSlots({ fromDate: fixtureDates.blocked, toDate: fixtureDates.blocked });
    assert(!blocked.dates.some(date => date.times.some(time => time.localTime === "10:00")), "Blocked slot returned.");

    const appointments = await findSlots({ fromDate: fixtureDates.appointment, toDate: fixtureDates.appointment });
    const appointmentTimes = appointments.dates.flatMap(date => date.times.map(time => time.localTime));
    assert(!appointmentTimes.includes("09:00"), "Appointment plus break did not block.");
    assert(appointmentTimes.includes("11:00"), "Pending appointment should not block.");
    assert(appointmentTimes.includes("12:15"), "A slot after the pending appointment should be available.");
    assert(appointmentTimes.includes("17:00"), "Expired pending appointment should not block.");
    assert(!appointmentTimes.includes("14:00"), "Zero-break appointment was not considered.");
    assert(!appointmentTimes.includes("15:00"), "Positive-break appointment was not considered.");

    const notice = await findSlots({
      fromDate: "2099-01-05",
      toDate: "2099-01-05",
      now: new Date("2099-01-05T00:00:00.000Z"),
      config: { ...config, minimumNoticeHours: 12 }
    });
    assert(!notice.dates.some(date => date.times.some(time => time.localTime === "09:00")), "Minimum notice was ignored.");

    await assertBookingError(
      findSlots({
        fromDate: "2099-01-05",
        toDate: "2099-01-05",
        config: { ...config, bookingHorizonDays: 2 }
      }),
      "date_range_out_of_bounds"
    );

    await assertBookingError(
      findService(pool, `Phase 2 inactive ${fixtureTag}`),
      "inactive_service"
    );
    await assertBookingError(
      findService(pool, "does-not-exist"),
      "invalid_service"
    );

    const springForward = localDateTimeToDate("2099-03-29", "02:30", config.timezone);
    assert.strictEqual(springForward, null, "Nonexistent DST local time should be rejected.");
    const beforeDst = localDateTimeToDate("2099-03-29", "01:30", config.timezone);
    const afterDst = localDateTimeToDate("2099-03-29", "03:30", config.timezone);
    assert(beforeDst && afterDst && afterDst > beforeDst, "DST timezone conversion failed.");
    assert.strictEqual(localTimeForInstant(afterDst, config.timezone), "03:30");

    const requestInput = (startAt, label = startAt) => ({
      service: "PT",
      startAt,
      clientName: "Phase 2 booking test",
      email: `${fixtureTag}-${label}.example@example.test`,
      phone: "",
      notes: "Phase 2 integration test"
    });
    const first = await createBookingRequest({
      pool,
      input: requestInput("2099-01-10T09:00:00+01:00", "first"),
      now,
      config
    });
    assert.strictEqual(first.status, "pending");
    assert.strictEqual(first.startsAt, null);
    assert(first.originalStartsAt, "Original requested time was not preserved.");
    const secondPending = await createBookingRequest({
      pool,
      input: requestInput("2099-01-10T09:00:00+01:00", "second"),
      now,
      config
    });
    assert.strictEqual(secondPending.status, "pending");
    const firstId = await pool.query(
      "SELECT id FROM booking.appointments WHERE client_email = $1",
      [first.clientEmail]
    );
    await pool.query(
      `UPDATE booking.appointments
       SET starts_at = $1, ends_at = $2, status = 'confirmed'
       WHERE id = $3`,
      ["2099-01-10T08:00:00Z", "2099-01-10T09:00:00Z", firstId.rows[0].id]
    );
    const overlap = await assertBookingError(
      createBookingRequest({
        pool,
        input: requestInput("2099-01-10T09:00:00+01:00", "third"),
        now,
        config
      }),
      "slot_unavailable"
    );
    assert.strictEqual(overlap.status, 409);

    const concurrentInputs = [
      requestInput("2099-01-10T11:00:00+01:00", "concurrent-0"),
      requestInput("2099-01-10T11:00:00+01:00", "concurrent-1")
    ].map((input, index) => ({
      ...input,
      email: `${fixtureTag}-concurrent-${index}@example.test`
    }));
    const concurrentResults = await Promise.all(
      concurrentInputs.map(input =>
        createBookingRequest({ pool, input, now, config })
          .then(result => ({ ok: true, result }))
          .catch(error => ({ ok: false, error }))
      )
    );
    assert.strictEqual(concurrentResults.filter(result => result.ok).length, 2, "Pending requests should not block each other.");

    console.log(JSON.stringify({
      ok: true,
      testsPassed: [
        "normal slot",
        "outside working hours",
        "blocked time",
        "unavailable override",
        "partial availability override",
        "appointment plus effective break",
        "pending appointment blocking",
        "expired pending availability",
        "minimum notice",
        "booking horizon",
        "inactive service rejection",
        "invalid service rejection",
        "overlapping booking rejection",
        "simultaneous booking race",
        "break override NULL/0/positive",
        "Europe/Stockholm DST handling"
      ]
    }, null, 2));
  } finally {
    await setupClient.query("ROLLBACK").catch(() => {});
    setupClient.release();
    const cleanupClient = await pool.connect();
    try {
      await cleanupClient.query("BEGIN");
      await cleanupClient.query(
        "DELETE FROM booking.appointments WHERE client_email LIKE $1",
        [`${fixtureTag}-%`]
      );
      await cleanupClient.query(
        "DELETE FROM booking.blocked_times WHERE reason = $1",
        [fixtureTag]
      );
      await cleanupClient.query(
        "DELETE FROM booking.availability_overrides WHERE reason = $1",
        [fixtureTag]
      );
      await cleanupClient.query(`
        DELETE FROM booking.availability_rules
        WHERE effective_from = $1 AND effective_until = $2
      `, [fixtureDates.rulesFrom, fixtureDates.rulesUntil]);
      if (inactiveServiceId) {
        await cleanupClient.query("DELETE FROM booking.services WHERE id = $1", [inactiveServiceId]);
      }
      await cleanupClient.query("COMMIT");
    } catch (error) {
      await cleanupClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      cleanupClient.release();
      await closePool();
    }
  }
}

main().catch(error => {
  console.error(`Phase 2 booking tests failed: ${error.message}`);
  process.exitCode = 1;
});