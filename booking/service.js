const crypto = require("crypto");
const { getBookingConfig } = require("./config");
const {
  addDays,
  formatDateOnly,
  localDateForInstant,
  localDateTimeToDate,
  localTimeForInstant,
  normalizeTime,
  parseDateOnly,
  parseInstant,
  weekdayForDateOnly
} = require("./time");

const MINUTES_MS = 60 * 1000;
const CALENDAR_LOCK_KEY = "halsopulsen-booking-calendar";
const CLIENT_ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createClientActionToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + CLIENT_ACTION_TOKEN_TTL_MS)
  };
}

class BookingError extends Error {
  constructor(message, status = 400, code = "booking_error") {
    super(message);
    this.name = "BookingError";
    this.status = status;
    this.code = code;
  }
}

function publicService(service) {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    durationMinutes: service.duration_minutes,
    defaultBreakMinutes: service.default_break_minutes
  };
}

async function listActiveServices(client) {
  const result = await client.query(`
    SELECT id, name, description, duration_minutes, default_break_minutes
    FROM booking.services
    WHERE active
    ORDER BY display_order, name
  `);
  return result.rows;
}

async function findService(client, identifier) {
  const value = String(identifier || "").trim();
  if (!value || value.length > 120) {
    throw new BookingError("A valid service is required.", 400, "invalid_service");
  }

  const result = /^\d+$/.test(value)
    ? await client.query(`
        SELECT id, name, description, duration_minutes, default_break_minutes, active
        FROM booking.services
        WHERE id = $1
      `, [Number(value)])
    : await client.query(`
        SELECT id, name, description, duration_minutes, default_break_minutes, active
        FROM booking.services
        WHERE lower(name) = lower($1)
      `, [value]);

  if (result.rowCount === 0) {
    throw new BookingError("That service does not exist.", 400, "invalid_service");
  }
  if (!result.rows[0].active) {
    throw new BookingError("That service is not available for booking.", 400, "inactive_service");
  }
  return result.rows[0];
}

function intervalOverlaps(start, end, otherStart, otherEnd) {
  return start < otherEnd && end > otherStart;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function effectiveBreakMinutes(appointment) {
  return appointment.break_minutes_override === null
    || appointment.break_minutes_override === undefined
    ? Number(appointment.default_break_minutes) || 0
    : Number(appointment.break_minutes_override) || 0;
}

function occupiedInterval(appointment) {
  const start = toDate(appointment.starts_at);
  const endsAt = toDate(appointment.ends_at);
  return {
    start,
    end: new Date(endsAt.getTime() + effectiveBreakMinutes(appointment) * MINUTES_MS)
  };
}

function databaseDateToIso(value) {
  if (value instanceof Date) return formatDateOnly(value);
  return String(value).slice(0, 10);
}

async function loadAvailabilityData(client, fromDate, toDateValue, windowStart, windowEnd, config) {
  // Keep these queries sequential when a transaction client is supplied.
  // pg clients cannot safely execute concurrent queries on one connection.
  const rules = await client.query(`
    SELECT weekday, start_time, end_time, timezone, effective_from, effective_until
    FROM booking.availability_rules
    WHERE active
      AND effective_from <= $2
      AND (effective_until IS NULL OR effective_until >= $1)
    ORDER BY weekday, start_time
  `, [fromDate, toDateValue]);
  const overrides = await client.query(`
    SELECT override_date, start_time, end_time, timezone, is_unavailable
    FROM booking.availability_overrides
    WHERE active AND override_date BETWEEN $1 AND $2
    ORDER BY override_date, start_time
  `, [fromDate, toDateValue]);
  const blocked = await client.query(`
    SELECT starts_at, ends_at
    FROM booking.blocked_times
    WHERE starts_at < $1 AND ends_at > $2
  `, [windowEnd, windowStart]);
  const appointments = await client.query(`
    SELECT a.starts_at, a.ends_at, a.break_minutes_override,
           s.default_break_minutes
    FROM booking.appointments a
    JOIN booking.services s ON s.id = a.service_id
    WHERE (
      a.status = 'confirmed'
      OR (
        a.status = 'pending'
        AND a.created_at >= NOW() - make_interval(hours => $1)
      )
    )
    AND a.starts_at < $2
  `, [config.pendingExpirationHours, windowEnd]);

  return {
    rules: rules.rows,
    overrides: overrides.rows,
    blocked: blocked.rows,
    appointments: appointments.rows
  };
}

function dateWindows(dateValue, data, config) {
  const weekday = weekdayForDateOnly(dateValue);
  const dateOverrides = data.overrides.filter(
    row => databaseDateToIso(row.override_date) === dateValue
  );
  let sourceRows;

  if (dateOverrides.length > 0) {
    if (dateOverrides.some(row => row.is_unavailable)) return [];
    sourceRows = dateOverrides;
  } else {
    sourceRows = data.rules.filter(row => {
      const effectiveFrom = databaseDateToIso(row.effective_from);
      const effectiveUntil = row.effective_until
        ? databaseDateToIso(row.effective_until)
        : null;
      return Number(row.weekday) === weekday
        && dateValue >= effectiveFrom
        && (!effectiveUntil || dateValue <= effectiveUntil);
    });
  }

  return sourceRows
    .map(row => {
      const start = localDateTimeToDate(
        dateValue,
        normalizeTime(row.start_time),
        row.timezone || config.timezone
      );
      const end = localDateTimeToDate(
        dateValue,
        normalizeTime(row.end_time),
        row.timezone || config.timezone
      );
      return start && end && end > start ? { start, end } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
}

function availableSlotsForDate(dateValue, service, data, options) {
  const {
    config,
    earliestStart,
    latestStart,
    durationMinutes = service.duration_minutes,
    breakMinutes = service.default_break_minutes,
    timezone = config.timezone
  } = options;
  const totalMinutes = Number(durationMinutes) + Number(breakMinutes);
  const windows = dateWindows(dateValue, data, config);
  const blockedIntervals = data.blocked.map(row => ({
    start: toDate(row.starts_at),
    end: toDate(row.ends_at)
  }));
  const appointmentIntervals = data.appointments.map(row => ({
    ...occupiedInterval(row),
    kind: "booked"
  }));
  const slots = [];
  const unavailableTimes = [];

  for (const window of windows) {
    const lastStart = window.end.getTime() - totalMinutes * MINUTES_MS;
    for (
      let cursor = window.start.getTime();
      cursor <= lastStart;
      cursor += config.slotIntervalMinutes * MINUTES_MS
    ) {
      const start = new Date(cursor);
      const end = new Date(cursor + totalMinutes * MINUTES_MS);
      if (start < earliestStart || start > latestStart) continue;
      const booked = appointmentIntervals.some(blocker => intervalOverlaps(start, end, blocker.start, blocker.end));
      const blocked = blockedIntervals.some(blocker => intervalOverlaps(start, end, blocker.start, blocker.end));
      if (booked || blocked) {
        unavailableTimes.push({
          startAt: start.toISOString(),
          localTime: localTimeForInstant(start, timezone),
          reason: booked ? "booked" : "unavailable"
        });
        continue;
      }
      slots.push({
        startAt: start.toISOString(),
        localTime: localTimeForInstant(start, timezone)
      });
    }
  }

  return { slots, unavailableTimes };
}

async function calculateAvailability({
  client,
  serviceIdentifier,
  fromDate,
  toDate: requestedToDate,
  now = new Date(),
  durationMinutes,
  breakMinutes,
  config: suppliedConfig
}) {
  const config = getBookingConfig(suppliedConfig);
  const service = await findService(client, serviceIdentifier);
  const today = localDateForInstant(now, config.timezone);
  const from = fromDate || today;
  const to = requestedToDate || addDays(from, config.bookingHorizonDays);

  if (!parseDateOnly(from) || !parseDateOnly(to) || from > to) {
    throw new BookingError("The availability date range is invalid.", 400, "invalid_date_range");
  }
  const maximumDate = addDays(today, config.bookingHorizonDays);
  if (from < today || to > maximumDate) {
    throw new BookingError(
      "Availability can only be requested within the booking horizon.",
      400,
      "date_range_out_of_bounds"
    );
  }

  const dayAfterTo = addDays(to, 1);
  const windowStart = localDateTimeToDate(from, "00:00", config.timezone);
  const windowEnd = localDateTimeToDate(dayAfterTo, "00:00", config.timezone);
  if (!windowStart || !windowEnd) {
    throw new BookingError("The availability date range is invalid.", 400, "invalid_date_range");
  }

  const data = await loadAvailabilityData(
    client,
    from,
    to,
    windowStart,
    windowEnd,
    config
  );
  const earliestStart = new Date(now.getTime() + config.minimumNoticeHours * 60 * 60 * 1000);
  const latestStart = new Date(now.getTime() + config.bookingHorizonDays * 24 * 60 * 60 * 1000);
  const dates = [];

  for (let dateValue = from; dateValue <= to; dateValue = addDays(dateValue, 1)) {
    const { slots, unavailableTimes } = availableSlotsForDate(dateValue, service, data, {
      config,
      earliestStart,
      latestStart,
      durationMinutes,
      breakMinutes
    });
    if (slots.length > 0 || unavailableTimes.length > 0) {
      dates.push({
        date: dateValue,
        times: slots,
        unavailableTimes
      });
    }
  }

  return { service, timezone: config.timezone, dates };
}

function validateClientInput(input) {
  const name = String(input?.clientName || input?.name || "").trim();
  const email = String(input?.email || "").trim().toLowerCase();
  const phone = String(input?.phone || "").trim();
  const notes = String(input?.notes || "").trim();

  if (!name || name.length > 120) {
    throw new BookingError("Client name must be between 1 and 120 characters.", 400, "invalid_client_name");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new BookingError("A valid email address is required.", 400, "invalid_email");
  }
  if (phone.length > 40) {
    throw new BookingError("Phone number must be 40 characters or fewer.", 400, "invalid_phone");
  }
  if (notes.length > 2000) {
    throw new BookingError("Notes must be 2,000 characters or fewer.", 400, "invalid_notes");
  }
  return { name, email, phone: phone || null, notes };
}

async function createBookingRequest({
  pool,
  input,
  now = new Date(),
  config: suppliedConfig
}) {
  const config = getBookingConfig(suppliedConfig);
  const startAt = parseInstant(input?.startTime || input?.startAt);
  if (!startAt) {
    throw new BookingError(
      "Start time must be an ISO timestamp with a timezone.",
      400,
      "invalid_start_time"
    );
  }
  const clientInput = validateClientInput(input);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // One practitioner/calendar is modeled in Phase 1. A transaction-scoped
    // advisory lock serializes final checks for every booking on that calendar.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [CALENDAR_LOCK_KEY]);

    const service = await findService(client, input?.service);
    const actionToken = createClientActionToken();
    const availability = await calculateAvailability({
      client,
      serviceIdentifier: service.id,
      fromDate: localDateForInstant(startAt, config.timezone),
      toDate: localDateForInstant(startAt, config.timezone),
      now,
      config
    });
    const requestedStart = startAt.toISOString();
    const requestedSlot = availability.dates
      .flatMap(date => date.times)
      .find(slot => slot.startAt === requestedStart);

    if (!requestedSlot) {
      throw new BookingError(
        "That time is not available.",
        409,
        "slot_unavailable"
      );
    }

    const sessionEnd = new Date(startAt.getTime() + service.duration_minutes * MINUTES_MS);
    const occupiedEnd = new Date(
      sessionEnd.getTime() + service.default_break_minutes * MINUTES_MS
    );
    const conflict = await client.query(`
      SELECT 1
      FROM booking.appointments a
      JOIN booking.services s ON s.id = a.service_id
      WHERE (
        a.status = 'confirmed'
        OR (
          a.status = 'pending'
          AND a.created_at >= NOW() - make_interval(hours => $1)
        )
      )
      AND a.starts_at < $3
      AND (
        a.ends_at
        + make_interval(mins => COALESCE(a.break_minutes_override, s.default_break_minutes))
      ) > $2
      LIMIT 1
    `, [config.pendingExpirationHours, startAt, occupiedEnd]);

    if (conflict.rowCount > 0) {
      throw new BookingError("That time is no longer available.", 409, "slot_unavailable");
    }

    await client.query(`
      INSERT INTO booking.appointments (
        service_id,
        client_name,
        client_email,
        client_phone,
        starts_at,
        ends_at,
        original_starts_at,
        original_ends_at,
        break_minutes_override,
        status,
        notes,
        client_action_token_hash,
        client_action_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $5, $6, NULL, 'pending', $7, $8, $9)
    `, [
      service.id,
      clientInput.name,
      clientInput.email,
      clientInput.phone,
      startAt,
      sessionEnd,
      clientInput.notes,
      actionToken.hash,
      actionToken.expiresAt
    ]);

    await client.query("COMMIT");
    return {
      status: "pending",
      actionToken: actionToken.token,
      serviceName: service.name,
      durationMinutes: service.duration_minutes,
      startsAt: startAt,
      endsAt: sessionEnd,
      clientName: clientInput.name,
      clientEmail: clientInput.email,
      clientPhone: clientInput.phone
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23P01") {
      throw new BookingError("That time is no longer available.", 409, "slot_unavailable");
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  BookingError,
  calculateAvailability,
  createBookingRequest,
  findService,
  listActiveServices,
  publicService
};