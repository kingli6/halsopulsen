const { getBookingConfig } = require("./config");
const { BookingError } = require("./service");
const {
  addDays,
  localDateForInstant,
  localDateTimeToDate,
  localTimeForInstant,
  normalizeTime,
  parseDateOnly,
  parseInstant
} = require("./time");

const MINUTES_MS = 60 * 1000;
const CALENDAR_LOCK_KEY = "halsopulsen-booking-calendar";
const VALID_STATUSES = new Set(["pending", "confirmed", "cancelled", "completed"]);
const LIST_STATUSES = new Set([...VALID_STATUSES, "alternative_suggested"]);

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength) {
    throw new BookingError(`${label} must be between 1 and ${maxLength} characters.`, 400, "invalid_input");
  }
  return text;
}

function optionalText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) {
    throw new BookingError(`${label} must be ${maxLength} characters or fewer.`, 400, "invalid_input");
  }
  return text;
}

function integerValue(value, label, { min, max, fallback } = {}) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BookingError(`${label} must be an integer between ${min} and ${max}.`, 400, "invalid_input");
  }
  return parsed;
}

function booleanValue(value, label, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === false) return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  throw new BookingError(`${label} must be true or false.`, 400, "invalid_input");
}

function dateValue(value, label, { required = true } = {}) {
  if (!value && !required) return null;
  if (!parseDateOnly(value)) {
    throw new BookingError(`${label} must use YYYY-MM-DD format.`, 400, "invalid_date");
  }
  return String(value);
}

function timeValue(value, label, { required = true } = {}) {
  if (!value && !required) return null;
  const normalized = normalizeTime(value);
  if (!normalized) {
    throw new BookingError(`${label} must use HH:MM format.`, 400, "invalid_time");
  }
  return normalized;
}

function formatDateFromDatabase(value) {
  if (value instanceof Date) {
    return [
      value.getUTCFullYear(),
      String(value.getUTCMonth() + 1).padStart(2, "0"),
      String(value.getUTCDate()).padStart(2, "0")
    ].join("-");
  }
  return String(value).slice(0, 10);
}

function formatTimeFromDatabase(value) {
  return String(value || "").slice(0, 5);
}

function publicAdminService(row) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    defaultBreakMinutes: row.default_break_minutes,
    displayOrder: row.display_order,
    active: row.active
  };
}

function publicRule(row) {
  return {
    id: String(row.id),
    weekday: row.weekday,
    start: formatTimeFromDatabase(row.start_time),
    end: formatTimeFromDatabase(row.end_time),
    timezone: row.timezone,
    effectiveFrom: formatDateFromDatabase(row.effective_from),
    effectiveUntil: row.effective_until ? formatDateFromDatabase(row.effective_until) : null,
    active: row.active
  };
}

function publicOverride(row) {
  return {
    id: String(row.id),
    date: formatDateFromDatabase(row.override_date),
    start: row.start_time ? formatTimeFromDatabase(row.start_time) : null,
    end: row.end_time ? formatTimeFromDatabase(row.end_time) : null,
    timezone: row.timezone,
    unavailable: row.is_unavailable,
    reason: row.reason,
    active: row.active
  };
}

function publicBlockedTime(row, timezone) {
  const start = new Date(row.starts_at);
  const end = new Date(row.ends_at);
  return {
    id: String(row.id),
    date: localDateForInstant(start, timezone),
    start: localTimeForInstant(start, timezone),
    end: localTimeForInstant(end, timezone),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    reason: row.reason,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function effectiveBreakMinutes(row) {
  return row.break_minutes_override === null || row.break_minutes_override === undefined
    ? Number(row.default_break_minutes) || 0
    : Number(row.break_minutes_override) || 0;
}

function publicAppointment(row, timezone) {
  const startsAt = new Date(row.starts_at);
  const endsAt = new Date(row.ends_at);
  return {
    id: String(row.id),
    serviceId: String(row.service_id),
    serviceName: row.service_name,
    durationMinutes: row.duration_minutes,
    clientName: row.client_name,
    email: row.client_email,
    phone: row.client_phone,
    date: localDateForInstant(startsAt, timezone),
    start: localTimeForInstant(startsAt, timezone),
    end: localTimeForInstant(endsAt, timezone),
    startAt: startsAt.toISOString(),
    endAt: endsAt.toISOString(),
    breakMinutesOverride: row.break_minutes_override,
    effectiveBreakMinutes: effectiveBreakMinutes(row),
    status: row.status,
    notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null
  };
}

function serviceInput(body, existing) {
  return {
    name: requiredText(body?.name ?? existing?.name, "Service name", 120),
    description: optionalText(body?.description ?? existing?.description, "Description", 1000),
    durationMinutes: integerValue(
      body?.durationMinutes ?? body?.duration_minutes ?? existing?.duration_minutes,
      "Duration",
      { min: 1, max: 1440 }
    ),
    defaultBreakMinutes: integerValue(
      body?.defaultBreakMinutes ?? body?.default_break_minutes ?? existing?.default_break_minutes,
      "Default break",
      { min: 0, max: 1440 }
    ),
    displayOrder: integerValue(
      body?.displayOrder ?? body?.display_order ?? existing?.display_order,
      "Display order",
      { min: 0, max: 10000 }
    ),
    active: booleanValue(body?.active ?? existing?.active, "Active", true)
  };
}

function ruleInput(body, existing, config) {
  const effectiveFrom = dateValue(
    body?.effectiveFrom ?? body?.effective_from ?? existing?.effective_from,
    "Effective from"
  );
  const effectiveUntil = dateValue(
    body?.effectiveUntil ?? body?.effective_until ?? existing?.effective_until,
    "Effective until",
    { required: false }
  );
  if (effectiveUntil && effectiveUntil < effectiveFrom) {
    throw new BookingError("Effective until must be on or after effective from.", 400, "invalid_date_range");
  }
  const start = timeValue(body?.start ?? body?.startTime ?? body?.start_time ?? existing?.start_time, "Start time");
  const end = timeValue(body?.end ?? body?.endTime ?? body?.end_time ?? existing?.end_time, "End time");
  if (end <= start) {
    throw new BookingError("End time must be after start time.", 400, "invalid_time_range");
  }
  return {
    weekday: integerValue(body?.weekday ?? existing?.weekday, "Weekday", { min: 1, max: 7 }),
    start,
    end,
    timezone: config.timezone,
    effectiveFrom,
    effectiveUntil,
    active: booleanValue(body?.active ?? existing?.active, "Active", true)
  };
}

function overrideInput(body, existing, config) {
  const unavailable = booleanValue(
    body?.unavailable ?? body?.isUnavailable ?? body?.is_unavailable ?? existing?.is_unavailable,
    "Unavailable",
    false
  );
  const date = dateValue(body?.date ?? body?.overrideDate ?? body?.override_date ?? existing?.override_date, "Date");
  const reason = optionalText(body?.reason ?? existing?.reason, "Reason", 500);
  const start = unavailable
    ? null
    : timeValue(body?.start ?? body?.startTime ?? body?.start_time ?? existing?.start_time, "Start time");
  const end = unavailable
    ? null
    : timeValue(body?.end ?? body?.endTime ?? body?.end_time ?? existing?.end_time, "End time");
  if (start && end && end <= start) {
    throw new BookingError("End time must be after start time.", 400, "invalid_time_range");
  }
  return {
    date,
    start,
    end,
    timezone: config.timezone,
    unavailable,
    reason,
    active: booleanValue(body?.active ?? existing?.active, "Active", true)
  };
}

function instantFromAdminInput(body, config, { start = true } = {}) {
  const instantField = start ? body?.startsAt : body?.endsAt;
  if (instantField) {
    const parsed = parseInstant(instantField);
    if (!parsed) {
      throw new BookingError(
        `${start ? "Start" : "End"} time must be an ISO timestamp with a timezone.`,
        400,
        "invalid_timestamp"
      );
    }
    return parsed;
  }
  const date = dateValue(body?.date, "Date");
  const time = timeValue(start ? body?.start : body?.end, start ? "Start time" : "End time");
  const parsed = localDateTimeToDate(date, time, config.timezone);
  if (!parsed) {
    throw new BookingError("The local time does not exist in the business timezone.", 400, "invalid_timestamp");
  }
  return parsed;
}

function blockedInput(body, config) {
  const startsAt = instantFromAdminInput(body, config, { start: true });
  const endsAt = instantFromAdminInput(body, config, { start: false });
  if (endsAt <= startsAt) {
    throw new BookingError("End time must be after start time.", 400, "invalid_time_range");
  }
  return {
    startsAt,
    endsAt,
    reason: optionalText(body?.reason, "Reason", 500)
  };
}

function appointmentStartInput(body, config, existingStart) {
  if (body?.startAt || body?.date || body?.start) {
    return instantFromAdminInput(
      body?.startAt ? { startsAt: body.startAt } : body,
      config,
      { start: true }
    );
  }
  return new Date(existingStart);
}

function appointmentBreakInput(body, existing) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, "breakMinutesOverride")
    && !Object.prototype.hasOwnProperty.call(body || {}, "break_minutes_override")) {
    return existing;
  }
  const value = body.breakMinutesOverride ?? body.break_minutes_override;
  if (value === null || value === "") return null;
  return integerValue(value, "Break override", { min: 0, max: 1440 });
}

function appointmentStatusInput(body, existing) {
  if (body?.status === undefined) return existing;
  const status = String(body.status);
  if (!VALID_STATUSES.has(status)) {
    throw new BookingError("Appointment status is invalid.", 400, "invalid_status");
  }
  return status;
}

async function findById(client, table, id) {
  const result = await client.query(`SELECT * FROM booking.${table} WHERE id = $1`, [id]);
  if (result.rowCount === 0) {
    throw new BookingError("The requested booking record was not found.", 404, "not_found");
  }
  return result.rows[0];
}

async function listServices(client) {
  const result = await client.query(`
    SELECT id, name, description, duration_minutes, default_break_minutes, display_order, active
    FROM booking.services
    ORDER BY display_order, name
  `);
  return result.rows.map(publicAdminService);
}

async function createService(client, body) {
  const input = serviceInput(body);
  try {
    const result = await client.query(`
      INSERT INTO booking.services (
        name, description, duration_minutes, default_break_minutes, display_order, active
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, description, duration_minutes, default_break_minutes, display_order, active
    `, [
      input.name,
      input.description,
      input.durationMinutes,
      input.defaultBreakMinutes,
      input.displayOrder,
      input.active
    ]);
    return publicAdminService(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new BookingError("A service with that name already exists.", 409, "duplicate_service");
    }
    throw error;
  }
}

async function updateService(client, id, body) {
  const existing = await findById(client, "services", id);
  const input = serviceInput(body, existing);
  try {
    const result = await client.query(`
      UPDATE booking.services
      SET name = $2,
          description = $3,
          duration_minutes = $4,
          default_break_minutes = $5,
          display_order = $6,
          active = $7
      WHERE id = $1
      RETURNING id, name, description, duration_minutes, default_break_minutes, display_order, active
    `, [
      id,
      input.name,
      input.description,
      input.durationMinutes,
      input.defaultBreakMinutes,
      input.displayOrder,
      input.active
    ]);
    return publicAdminService(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new BookingError("A service with that name already exists.", 409, "duplicate_service");
    }
    throw error;
  }
}

async function listRules(client) {
  const result = await client.query(`
    SELECT id, weekday, start_time, end_time, timezone,
           effective_from, effective_until, active
    FROM booking.availability_rules
    ORDER BY weekday, start_time, effective_from
  `);
  return result.rows.map(publicRule);
}

async function createRule(client, body) {
  const input = ruleInput(body, null, getBookingConfig());
  const result = await client.query(`
    INSERT INTO booking.availability_rules (
      weekday, start_time, end_time, timezone, effective_from, effective_until, active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, weekday, start_time, end_time, timezone, effective_from, effective_until, active
  `, [
    input.weekday,
    input.start,
    input.end,
    input.timezone,
    input.effectiveFrom,
    input.effectiveUntil,
    input.active
  ]);
  return publicRule(result.rows[0]);
}

async function updateRule(client, id, body) {
  const existing = await findById(client, "availability_rules", id);
  const input = ruleInput(body, existing, getBookingConfig());
  const result = await client.query(`
    UPDATE booking.availability_rules
    SET weekday = $2,
        start_time = $3,
        end_time = $4,
        timezone = $5,
        effective_from = $6,
        effective_until = $7,
        active = $8
    WHERE id = $1
    RETURNING id, weekday, start_time, end_time, timezone, effective_from, effective_until, active
  `, [
    id,
    input.weekday,
    input.start,
    input.end,
    input.timezone,
    input.effectiveFrom,
    input.effectiveUntil,
    input.active
  ]);
  return publicRule(result.rows[0]);
}

async function listOverrides(client) {
  const result = await client.query(`
    SELECT id, override_date, start_time, end_time, timezone,
           is_unavailable, reason, active
    FROM booking.availability_overrides
    ORDER BY override_date, start_time NULLS FIRST, id
  `);
  return result.rows.map(publicOverride);
}

async function createOverride(client, body) {
  const input = overrideInput(body, null, getBookingConfig());
  const result = await client.query(`
    INSERT INTO booking.availability_overrides (
      override_date, start_time, end_time, timezone, is_unavailable, reason, active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, override_date, start_time, end_time, timezone, is_unavailable, reason, active
  `, [
    input.date,
    input.start,
    input.end,
    input.timezone,
    input.unavailable,
    input.reason,
    input.active
  ]);
  return publicOverride(result.rows[0]);
}

async function updateOverride(client, id, body) {
  const existing = await findById(client, "availability_overrides", id);
  const input = overrideInput(body, existing, getBookingConfig());
  const result = await client.query(`
    UPDATE booking.availability_overrides
    SET override_date = $2,
        start_time = $3,
        end_time = $4,
        timezone = $5,
        is_unavailable = $6,
        reason = $7,
        active = $8
    WHERE id = $1
    RETURNING id, override_date, start_time, end_time, timezone, is_unavailable, reason, active
  `, [
    id,
    input.date,
    input.start,
    input.end,
    input.timezone,
    input.unavailable,
    input.reason,
    input.active
  ]);
  return publicOverride(result.rows[0]);
}

async function listBlockedTimes(client, config = getBookingConfig()) {
  const result = await client.query(`
    SELECT id, starts_at, ends_at, reason, created_at
    FROM booking.blocked_times
    ORDER BY starts_at
  `);
  return result.rows.map(row => publicBlockedTime(row, config.timezone));
}

async function createBlockedTime(client, body, config = getBookingConfig()) {
  const input = blockedInput(body, config);
  const result = await client.query(`
    INSERT INTO booking.blocked_times (starts_at, ends_at, reason)
    VALUES ($1, $2, $3)
    RETURNING id, starts_at, ends_at, reason, created_at
  `, [input.startsAt, input.endsAt, input.reason]);
  return publicBlockedTime(result.rows[0], config.timezone);
}

async function updateBlockedTime(client, id, body, config = getBookingConfig()) {
  await findById(client, "blocked_times", id);
  const input = blockedInput(body, config);
  const result = await client.query(`
    UPDATE booking.blocked_times
    SET starts_at = $2, ends_at = $3, reason = $4
    WHERE id = $1
    RETURNING id, starts_at, ends_at, reason, created_at
  `, [id, input.startsAt, input.endsAt, input.reason]);
  return publicBlockedTime(result.rows[0], config.timezone);
}

const APPOINTMENT_SELECT = `
  SELECT a.id, a.service_id, a.client_name, a.client_email, a.client_phone,
         a.starts_at, a.ends_at, a.break_minutes_override, a.status, a.notes,
         a.created_at, a.updated_at, a.cancelled_at,
         s.name AS service_name, s.duration_minutes, s.default_break_minutes
  FROM booking.appointments a
  JOIN booking.services s ON s.id = a.service_id
`;

async function listAppointments(client, query = {}, config = getBookingConfig()) {
  const conditions = [];
  const params = [];
  const addParam = value => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.status) {
    const status = String(query.status);
    if (!LIST_STATUSES.has(status)) {
      throw new BookingError("Appointment status is invalid.", 400, "invalid_status");
    }
    conditions.push(`a.status = ${addParam(status)}`);
  }
  if (query.from) {
    const from = dateValue(query.from, "From date");
    const start = localDateTimeToDate(from, "00:00", config.timezone);
    conditions.push(`a.starts_at >= ${addParam(start)}`);
  }
  if (query.to) {
    const to = dateValue(query.to, "To date");
    const end = localDateTimeToDate(addDays(to, 1), "00:00", config.timezone);
    conditions.push(`a.starts_at < ${addParam(end)}`);
  }

  const result = await client.query(`
    ${APPOINTMENT_SELECT}
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY a.starts_at DESC
    LIMIT 500
  `, params);
  return result.rows.map(row => publicAppointment(row, config.timezone));
}

async function getAppointment(client, id, config = getBookingConfig()) {
  const result = await client.query(`
    ${APPOINTMENT_SELECT}
    WHERE a.id = $1
  `, [id]);
  if (result.rowCount === 0) {
    throw new BookingError("Appointment not found.", 404, "not_found");
  }
  return publicAppointment(result.rows[0], config.timezone);
}

async function ensureAppointmentRangeIsFree(client, {
  id,
  startsAt,
  endsAt,
  breakMinutes,
  pendingExpirationHours
}) {
  const occupiedEnd = new Date(endsAt.getTime() + breakMinutes * MINUTES_MS);
  const conflict = await client.query(`
    SELECT 1
    FROM booking.appointments a
    JOIN booking.services s ON s.id = a.service_id
    WHERE a.id <> $1
      AND (
        a.status = 'confirmed'
        OR (
          a.status = 'pending'
          AND a.created_at >= NOW() - make_interval(hours => $2)
        )
      )
      AND a.starts_at < $4
      AND (
        a.ends_at
        + make_interval(mins => COALESCE(a.break_minutes_override, s.default_break_minutes))
      ) > $3
    LIMIT 1
  `, [id, pendingExpirationHours, startsAt, occupiedEnd]);
  if (conflict.rowCount > 0) {
    throw new BookingError("That appointment time overlaps another active appointment.", 409, "slot_unavailable");
  }

  const blocked = await client.query(`
    SELECT 1
    FROM booking.blocked_times
    WHERE starts_at < $2 AND ends_at > $1
    LIMIT 1
  `, [startsAt, occupiedEnd]);
  if (blocked.rowCount > 0) {
    throw new BookingError("That appointment time overlaps a blocked period.", 409, "blocked_time");
  }
}

async function updateAppointment(pool, id, body, config = getBookingConfig()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [CALENDAR_LOCK_KEY]);

    const result = await client.query(`
      ${APPOINTMENT_SELECT}
      WHERE a.id = $1
      FOR UPDATE OF a
    `, [id]);
    if (result.rowCount === 0) {
      throw new BookingError("Appointment not found.", 404, "not_found");
    }
    const existing = result.rows[0];
    const status = appointmentStatusInput(body, existing.status);
    const startsAt = appointmentStartInput(body, config, existing.starts_at);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BookingError("Appointment start time is invalid.", 400, "invalid_timestamp");
    }
    const endsAt = new Date(
      startsAt.getTime() + Number(existing.duration_minutes) * MINUTES_MS
    );
    const breakMinutes = appointmentBreakInput(body, existing.break_minutes_override);

    if (status === "pending" || status === "confirmed") {
      await ensureAppointmentRangeIsFree(client, {
        id,
        startsAt,
        endsAt,
        breakMinutes: breakMinutes === null
          ? Number(existing.default_break_minutes) || 0
          : breakMinutes,
        pendingExpirationHours: config.pendingExpirationHours
      });
    }

    const cancelledAt = status === "cancelled" ? new Date() : null;
    const updated = await client.query(`
      UPDATE booking.appointments
      SET starts_at = $2,
          ends_at = $3,
          break_minutes_override = $4,
          status = $5,
          cancelled_at = $6
      WHERE id = $1
      RETURNING id
    `, [id, startsAt, endsAt, breakMinutes, status, cancelledAt]);
    await client.query("COMMIT");
    return getAppointment(pool, updated.rows[0].id, config);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function calendarEvents(client, query = {}, config = getBookingConfig()) {
  const from = dateValue(query.from, "From date");
  const to = dateValue(query.to, "To date");
  if (from > to) {
    throw new BookingError("From date must be on or before to date.", 400, "invalid_date_range");
  }
  const start = localDateTimeToDate(from, "00:00", config.timezone);
  const end = localDateTimeToDate(addDays(to, 1), "00:00", config.timezone);
  const [appointments, blocked] = await Promise.all([
    listAppointments(client, { from, to }, config),
    client.query(`
      SELECT id, starts_at, ends_at, reason, created_at
      FROM booking.blocked_times
      WHERE starts_at < $1 AND ends_at > $2
      ORDER BY starts_at
    `, [end, start])
  ]);
  return {
    from,
    to,
    timezone: config.timezone,
    appointments,
    blockedTimes: blocked.rows.map(row => publicBlockedTime(row, config.timezone))
  };
}

module.exports = {
  calendarEvents,
  createBlockedTime,
  createOverride,
  createRule,
  createService,
  ensureAppointmentRangeIsFree,
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
};