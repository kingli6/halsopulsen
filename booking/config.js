const DEFAULTS = Object.freeze({
  timezone: "Europe/Stockholm",
  minimumNoticeHours: 0,
  bookingHorizonDays: 60,
  pendingExpirationHours: 24,
  slotIntervalMinutes: 15
});

function numberAtLeast(value, fallback, minimum, { integer = false } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || (integer && !Number.isInteger(parsed))) {
    return fallback;
  }
  return parsed;
}

function getBookingConfig(overrides = {}) {
  return {
    timezone: overrides.timezone || process.env.BOOKING_TIMEZONE || DEFAULTS.timezone,
    minimumNoticeHours: numberAtLeast(
      overrides.minimumNoticeHours ?? process.env.BOOKING_MIN_NOTICE_HOURS,
      DEFAULTS.minimumNoticeHours,
      0
    ),
    bookingHorizonDays: numberAtLeast(
      overrides.bookingHorizonDays ?? process.env.BOOKING_HORIZON_DAYS,
      DEFAULTS.bookingHorizonDays,
      1
    ),
    pendingExpirationHours: numberAtLeast(
      overrides.pendingExpirationHours ?? process.env.BOOKING_PENDING_EXPIRATION_HOURS,
      DEFAULTS.pendingExpirationHours,
      1
    ),
    slotIntervalMinutes: numberAtLeast(
      overrides.slotIntervalMinutes ?? process.env.BOOKING_SLOT_INTERVAL_MINUTES,
      DEFAULTS.slotIntervalMinutes,
      1,
      { integer: true }
    )
  };
}

async function loadBookingConfig(client, overrides = {}) {
  const config = getBookingConfig(overrides);
  if (!client || Object.prototype.hasOwnProperty.call(overrides, "minimumNoticeHours")) {
    return config;
  }

  const result = await client.query(`
    SELECT minimum_notice_hours
    FROM booking.settings
    WHERE id = 1
  `);
  if (result.rowCount === 0) return config;

  return {
    ...config,
    minimumNoticeHours: numberAtLeast(
      result.rows[0].minimum_notice_hours,
      config.minimumNoticeHours,
      0,
      { integer: true }
    )
  };
}

module.exports = {
  DEFAULT_BOOKING_CONFIG: DEFAULTS,
  getBookingConfig,
  loadBookingConfig
};