const crypto = require("crypto");
const { getBookingConfig } = require("./config");
const {
  BookingError,
  calculateAvailability
} = require("./service");
const { ensureAppointmentRangeIsFree } = require("./admin-service");
const {
  localDateForInstant,
  localDateTimeToDate,
  localTimeForInstant,
  parseInstant
} = require("./time");

const CALENDAR_LOCK_KEY = "halsopulsen-booking-calendar";
const CLIENT_ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VALID_WORKFLOW_STATUSES = new Set(["pending", "alternative_suggested", "confirmed"]);

const WORKFLOW_SELECT = `
  SELECT a.id, a.service_id, a.client_name, a.client_email, a.client_phone,
         a.starts_at, a.ends_at, a.original_starts_at, a.original_ends_at,
         a.alternative_starts_at, a.alternative_ends_at,
         a.break_minutes_override, a.status, a.notes, a.cancelled_at,
         a.client_action_token_hash, a.client_action_expires_at,
         a.client_action_used_at,
         s.name AS service_name, s.duration_minutes, s.default_break_minutes
  FROM booking.appointments a
  JOIN booking.services s ON s.id = a.service_id
`;

function createActionToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + CLIENT_ACTION_TOKEN_TTL_MS)
  };
}

function hashActionToken(token) {
  const value = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(value)) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
}

function formatDateTime(date, timezone) {
  const value = new Date(date);
  return {
    date: localDateForInstant(value, timezone),
    time: localTimeForInstant(value, timezone)
  };
}

function workflowSnapshot(row, config = getBookingConfig(), overrides = {}) {
  const originalStart = row.original_starts_at || row.starts_at;
  const originalEnd = row.original_ends_at || row.ends_at;
  const snapshot = {
    id: String(row.id),
    serviceName: row.service_name,
    durationMinutes: Number(row.duration_minutes),
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    originalStartsAt: originalStart,
    originalEndsAt: originalEnd,
    alternativeStartsAt: row.alternative_starts_at,
    alternativeEndsAt: row.alternative_ends_at,
    status: row.status,
    notes: row.notes,
    ...overrides
  };
  snapshot.requested = formatDateTime(snapshot.originalStartsAt, config.timezone);
  if (snapshot.alternativeStartsAt) {
    snapshot.alternative = formatDateTime(snapshot.alternativeStartsAt, config.timezone);
  }
  snapshot.current = formatDateTime(snapshot.startsAt, config.timezone);
  return snapshot;
}

async function findAppointment(client, id, { forUpdate = false } = {}) {
  const result = await client.query(
    `${WORKFLOW_SELECT} WHERE a.id = $1${forUpdate ? " FOR UPDATE OF a" : ""}`,
    [id]
  );
  if (result.rowCount === 0) {
    throw new BookingError("Appointment not found.", 404, "not_found");
  }
  return result.rows[0];
}

async function findAppointmentByToken(client, token, { forUpdate = false } = {}) {
  const hash = hashActionToken(token);
  if (!hash) {
    throw new BookingError("That booking link is invalid.", 404, "invalid_token");
  }
  const result = await client.query(
    `${WORKFLOW_SELECT} WHERE a.client_action_token_hash = $1${forUpdate ? " FOR UPDATE OF a" : ""}`,
    [hash]
  );
  if (result.rowCount === 0) {
    throw new BookingError("That booking link is invalid or has already been used.", 404, "invalid_token");
  }
  const row = result.rows[0];
  if (row.client_action_used_at) {
    throw new BookingError("That booking link has already been used.", 410, "token_used");
  }
  if (!row.client_action_expires_at || new Date(row.client_action_expires_at) <= new Date()) {
    throw new BookingError("That booking link has expired.", 410, "token_expired");
  }
  return row;
}

function requireWorkflowStatus(row, allowed, message = "This booking can no longer be changed.") {
  if (!allowed.includes(row.status)) {
    throw new BookingError(message, 409, "invalid_transition");
  }
}

function alternativeStartFromInput(body, config) {
  if (body?.alternativeStartAt) {
    const parsed = parseInstant(body.alternativeStartAt);
    if (!parsed) {
      throw new BookingError("The suggested start time must include a timezone.", 400, "invalid_timestamp");
    }
    return parsed;
  }
  const date = body?.alternativeDate ?? body?.date;
  const time = body?.alternativeStart ?? body?.start;
  const parsed = localDateTimeToDate(date, time, config.timezone);
  if (!parsed) {
    throw new BookingError("A valid suggested date and start time are required.", 400, "invalid_timestamp");
  }
  return parsed;
}

async function assertAvailable(client, row, startsAt, config) {
  const date = localDateForInstant(startsAt, config.timezone);
  const availability = await calculateAvailability({
    client,
    serviceIdentifier: row.service_id,
    fromDate: date,
    toDate: date,
    config
  });
  const requestedSlot = availability.dates
    .flatMap(item => item.times)
    .find(item => item.startAt === startsAt.toISOString());
  if (!requestedSlot) {
    throw new BookingError("That suggested time is no longer available.", 409, "slot_unavailable");
  }
  const endsAt = new Date(startsAt.getTime() + Number(row.duration_minutes) * 60 * 1000);
  await ensureAppointmentRangeIsFree(client, {
    id: row.id,
    startsAt,
    endsAt,
    breakMinutes: Number(row.default_break_minutes) || 0,
    pendingExpirationHours: config.pendingExpirationHours
  });
  return endsAt;
}

async function beginCalendarTransaction(pool) {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [CALENDAR_LOCK_KEY]);
  return client;
}

async function confirmAppointment(pool, id, config = getBookingConfig()) {
  const client = await beginCalendarTransaction(pool);
  try {
    const row = await findAppointment(client, id, { forUpdate: true });
    requireWorkflowStatus(row, ["pending", "cancelled"], "Only pending or cancelled bookings can be confirmed.");
    const startsAt = new Date(row.starts_at);
    const endsAt = new Date(row.ends_at);
    await ensureAppointmentRangeIsFree(client, {
      id,
      startsAt,
      endsAt,
      breakMinutes: row.break_minutes_override === null
        ? Number(row.default_break_minutes) || 0
        : Number(row.break_minutes_override) || 0,
      pendingExpirationHours: config.pendingExpirationHours
    });
    const actionToken = createActionToken();
    await client.query(`
      UPDATE booking.appointments
      SET status = 'confirmed',
          cancelled_at = NULL,
          alternative_starts_at = NULL,
          alternative_ends_at = NULL,
          client_action_token_hash = $2,
          client_action_expires_at = $3,
          client_action_used_at = NULL
      WHERE id = $1
    `, [id, actionToken.hash, actionToken.expiresAt]);
    await client.query("COMMIT");
    return {
      booking: workflowSnapshot(row, config, { status: "confirmed" }),
      actionToken: actionToken.token
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function cancelAppointment(pool, id, config = getBookingConfig()) {
  const client = await beginCalendarTransaction(pool);
  try {
    const row = await findAppointment(client, id, { forUpdate: true });
    requireWorkflowStatus(row, ["pending", "alternative_suggested", "confirmed"]);
    await client.query(`
      UPDATE booking.appointments
      SET status = 'cancelled',
          cancelled_at = CURRENT_TIMESTAMP,
          alternative_starts_at = NULL,
          alternative_ends_at = NULL,
          client_action_token_hash = NULL,
          client_action_expires_at = NULL,
          client_action_used_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);
    await client.query("COMMIT");
    return { booking: workflowSnapshot(row, config, { status: "cancelled" }) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function suggestAlternative(pool, id, body, config = getBookingConfig()) {
  const client = await beginCalendarTransaction(pool);
  try {
    const row = await findAppointment(client, id, { forUpdate: true });
    requireWorkflowStatus(row, ["pending"], "Only pending bookings can receive an alternative time.");
    const startsAt = alternativeStartFromInput(body, config);
    const endsAt = await assertAvailable(client, row, startsAt, config);
    const actionToken = createActionToken();
    await client.query(`
      UPDATE booking.appointments
      SET status = 'alternative_suggested',
          alternative_starts_at = $2,
          alternative_ends_at = $3,
          client_action_token_hash = $4,
          client_action_expires_at = $5,
          client_action_used_at = NULL
      WHERE id = $1
    `, [id, startsAt, endsAt, actionToken.hash, actionToken.expiresAt]);
    await client.query("COMMIT");
    return {
      booking: workflowSnapshot(row, config, {
        status: "alternative_suggested",
        alternativeStartsAt: startsAt,
        alternativeEndsAt: endsAt
      }),
      actionToken: actionToken.token
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function publicActionState(row, config = getBookingConfig()) {
  const result = {
    status: row.status,
    service: {
      name: row.service_name,
      durationMinutes: Number(row.duration_minutes)
    },
    requested: formatDateTime(row.original_starts_at || row.starts_at, config.timezone),
    expiresAt: new Date(row.client_action_expires_at).toISOString()
  };
  if (row.status === "alternative_suggested") {
    result.alternative = formatDateTime(row.alternative_starts_at, config.timezone);
  }
  if (row.status === "confirmed") {
    result.confirmed = formatDateTime(row.starts_at, config.timezone);
  }
  return result;
}

async function getClientAction(pool, token, config = getBookingConfig()) {
  const row = await findAppointmentByToken(pool, token);
  if (!VALID_WORKFLOW_STATUSES.has(row.status)) {
    throw new BookingError("This booking link is no longer active.", 409, "invalid_transition");
  }
  return publicActionState(row, config);
}

async function acceptAlternative(pool, token, config = getBookingConfig()) {
  const client = await beginCalendarTransaction(pool);
  try {
    const row = await findAppointmentByToken(client, token, { forUpdate: true });
    requireWorkflowStatus(row, ["alternative_suggested"], "This alternative-time offer is no longer active.");
    const startsAt = new Date(row.alternative_starts_at);
    const endsAt = await assertAvailable(client, row, startsAt, config);
    const actionToken = createActionToken();
    await client.query(`
      UPDATE booking.appointments
      SET starts_at = $2,
          ends_at = $3,
          status = 'confirmed',
          alternative_starts_at = NULL,
          alternative_ends_at = NULL,
          cancelled_at = NULL,
          client_action_token_hash = $4,
          client_action_expires_at = $5,
          client_action_used_at = NULL
      WHERE id = $1
    `, [row.id, startsAt, endsAt, actionToken.hash, actionToken.expiresAt]);
    await client.query("COMMIT");
    return {
      booking: workflowSnapshot(row, config, {
        status: "confirmed",
        startsAt,
        endsAt,
        alternativeStartsAt: null,
        alternativeEndsAt: null
      }),
      actionToken: actionToken.token
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function cancelByToken(pool, token, config = getBookingConfig()) {
  const client = await beginCalendarTransaction(pool);
  try {
    const row = await findAppointmentByToken(client, token, { forUpdate: true });
    requireWorkflowStatus(row, ["pending", "alternative_suggested", "confirmed"]);
    await client.query(`
      UPDATE booking.appointments
      SET status = 'cancelled',
          cancelled_at = CURRENT_TIMESTAMP,
          alternative_starts_at = NULL,
          alternative_ends_at = NULL,
          client_action_token_hash = NULL,
          client_action_expires_at = NULL,
          client_action_used_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [row.id]);
    await client.query("COMMIT");
    return { booking: workflowSnapshot(row, config, { status: "cancelled" }) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function declineAlternative(pool, token, config = getBookingConfig()) {
  const client = await beginCalendarTransaction(pool);
  try {
    const row = await findAppointmentByToken(client, token, { forUpdate: true });
    requireWorkflowStatus(row, ["alternative_suggested"], "This alternative-time offer is no longer active.");
    await client.query(`
      UPDATE booking.appointments
      SET status = 'cancelled',
          cancelled_at = CURRENT_TIMESTAMP,
          alternative_starts_at = NULL,
          alternative_ends_at = NULL,
          client_action_token_hash = NULL,
          client_action_expires_at = NULL,
          client_action_used_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [row.id]);
    await client.query("COMMIT");
    return { booking: workflowSnapshot(row, config, { status: "cancelled" }) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  acceptAlternative,
  cancelAppointment,
  cancelByToken,
  confirmAppointment,
  declineAlternative,
  getClientAction,
  suggestAlternative
};