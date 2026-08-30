const { getPool, closePool } = require("../booking/db");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isoUtc(hour, minute = 0) {
  return new Date(Date.UTC(2030, 0, 7, hour, minute)).toISOString();
}

async function run() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const serviceInsert = await client.query(
      `
        INSERT INTO booking.services (
          name, description, duration_minutes, default_break_minutes, display_order
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, active
      `,
      [`Database test service ${Date.now()}`, "Test service", 45, 0, 99]
    );
    const service = serviceInsert.rows[0];
    assert(service.active === true, "Services should start active.");

    const serviceRead = await client.query(
      "SELECT id, duration_minutes, default_break_minutes FROM booking.services WHERE id = $1",
      [service.id]
    );
    assert(serviceRead.rows[0].duration_minutes === 45, "Service read failed.");
    assert(
      serviceRead.rows[0].default_break_minutes === 0,
      "A zero service break should be valid."
    );

    await client.query(
      "UPDATE booking.services SET active = false WHERE id = $1",
      [service.id]
    );
    const inactive = await client.query(
      "SELECT active FROM booking.services WHERE id = $1",
      [service.id]
    );
    assert(inactive.rows[0].active === false, "Service deactivation failed.");

    await client.query(
      "UPDATE booking.services SET active = true, duration_minutes = 60 WHERE id = $1",
      [service.id]
    );
    const reactivated = await client.query(
      "SELECT active, duration_minutes FROM booking.services WHERE id = $1",
      [service.id]
    );
    assert(reactivated.rows[0].active === true, "Service activation failed.");
    assert(reactivated.rows[0].duration_minutes === 60, "Service update failed.");

    const ruleInsert = await client.query(
      `
        INSERT INTO booking.availability_rules (
          weekday, start_time, end_time, timezone, effective_from, effective_until
        )
        VALUES
          (1, '09:00', '12:00', 'Europe/Stockholm', '2030-01-01', '2030-06-30'),
          (1, '13:00', '17:00', 'Europe/Stockholm', '2030-01-01', '2030-06-30')
        RETURNING id
      `
    );
    assert(ruleInsert.rowCount === 2, "Multiple periods on one weekday failed.");

    const rules = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM booking.availability_rules
        WHERE weekday = 1
          AND effective_from = '2030-01-01'
          AND effective_until = '2030-06-30'
      `
    );
    assert(rules.rows[0].count >= 2, "Effective availability dates failed.");

    const overrideInsert = await client.query(
      `
        INSERT INTO booking.availability_overrides (
          override_date, start_time, end_time, timezone, is_unavailable, reason
        )
        VALUES
          ('2030-01-14', '09:00', '12:00', 'Europe/Stockholm', false, 'Short day'),
          ('2030-01-15', NULL, NULL, 'Europe/Stockholm', true, 'Closed')
        RETURNING id
      `
    );
    assert(overrideInsert.rowCount === 2, "Availability overrides failed.");

    const blockedInsert = await client.query(
      `
        INSERT INTO booking.blocked_times (starts_at, ends_at, reason)
        VALUES
          ($1, $2, 'Short block'),
          ($3, $4, 'Long block')
        RETURNING id
      `,
      [isoUtc(13), isoUtc(13, 30), isoUtc(13), isoUtc(14, 15)]
    );
    assert(blockedInsert.rowCount === 2, "Arbitrary blocked periods failed.");

    const appointmentStatuses = ["pending", "confirmed", "cancelled", "completed"];
    for (const [index, status] of appointmentStatuses.entries()) {
      const startHour = 9 + index * 2;
      const appointment = await client.query(
        `
          INSERT INTO booking.appointments (
            service_id, client_name, client_email, starts_at, ends_at,
            break_minutes, status, notes, cancelled_at
          )
          VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)
          RETURNING status, break_minutes, starts_at, ends_at
        `,
        [
          service.id,
          `Test client ${status}`,
          `${status}@example.test`,
          isoUtc(startHour),
          isoUtc(startHour + 1),
          status,
          "Database test",
          status === "cancelled" ? isoUtc(startHour + 1, 5) : null
        ]
      );

      assert(
        appointment.rows[0].status === status,
        `Appointment status ${status} failed.`
      );
      assert(
        appointment.rows[0].break_minutes === 0,
        `Appointment break_minutes = 0 failed for ${status}.`
      );
      assert(
        appointment.rows[0].starts_at.toISOString() === isoUtc(startHour),
        `Appointment start timestamp failed for ${status}.`
      );
    }

    await client.query("SAVEPOINT overlap_test");
    await client.query(
      `
        INSERT INTO booking.appointments (
          service_id, client_name, client_email, starts_at, ends_at, status
        )
        VALUES ($1, 'Overlap test', 'overlap@example.test', $2, $3, 'pending')
      `,
      [service.id, isoUtc(17), isoUtc(18)]
    );

    let overlapRejected = false;
    try {
      await client.query(
        `
          INSERT INTO booking.appointments (
            service_id, client_name, client_email, starts_at, ends_at, status
          )
          VALUES ($1, 'Conflicting test', 'conflict@example.test', $2, $3, 'confirmed')
        `,
        [service.id, isoUtc(17, 30), isoUtc(18, 30)]
      );
    } catch (error) {
      overlapRejected = error.code === "23P01";
    }
    await client.query("ROLLBACK TO SAVEPOINT overlap_test");
    assert(
      overlapRejected,
      "Pending/confirmed appointment overlap should be rejected by PostgreSQL."
    );

    await client.query("ROLLBACK");
    console.log(
      "Booking database checks passed: services, activation, recurring rules, overrides, arbitrary blocks, appointment statuses, zero breaks, timestamps, and overlap protection."
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

run().catch(error => {
  console.error(`Booking database checks failed: ${error.message}`);
  process.exitCode = 1;
});