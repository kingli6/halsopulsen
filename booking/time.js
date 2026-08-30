const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

const zonedFormatterCache = new Map();

function parseDateOnly(value) {
  const match = DATE_PATTERN.exec(String(value || ""));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatDateOnly(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function addDays(dateValue, amount) {
  const date = parseDateOnly(dateValue);
  if (!date || !Number.isInteger(amount)) return null;
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateOnly(date);
}

function normalizeTime(value) {
  const match = TIME_PATTERN.exec(String(value || ""));
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function getZonedFormatter(timezone) {
  if (!zonedFormatterCache.has(timezone)) {
    zonedFormatterCache.set(timezone, new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      calendar: "iso8601",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }));
  }
  return zonedFormatterCache.get(timezone);
}

function getZonedParts(date, timezone) {
  const values = {};
  for (const part of getZonedFormatter(timezone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function zonedPartsToWallMs(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

function sameZonedParts(left, right) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function localDateTimeToDate(dateValue, timeValue, timezone) {
  const date = parseDateOnly(dateValue);
  const time = normalizeTime(timeValue);
  if (!date || !time) return null;

  const [hour, minute, second] = time.split(":").map(Number);
  const requested = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour,
    minute,
    second
  };
  const wallMs = zonedPartsToWallMs(requested);
  const offsets = new Set();

  // Sampling around the requested wall time finds both sides of a DST
  // transition, which also lets us detect ambiguous/nonexistent local times.
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = new Date(wallMs + hours * 60 * 60 * 1000);
    const sampleParts = getZonedParts(sample, timezone);
    offsets.add(zonedPartsToWallMs(sampleParts) - sample.getTime());
  }

  const candidates = [];
  for (const offset of offsets) {
    const candidate = new Date(wallMs - offset);
    if (sameZonedParts(getZonedParts(candidate, timezone), requested)) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((left, right) => left.getTime() - right.getTime());
  return candidates[0];
}

function parseInstant(value) {
  const text = String(value || "").trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateForInstant(date, timezone) {
  const parts = getZonedParts(date, timezone);
  return [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

function localTimeForInstant(date, timezone) {
  const parts = getZonedParts(date, timezone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function weekdayForDateOnly(dateValue) {
  const date = parseDateOnly(dateValue);
  if (!date) return null;
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

module.exports = {
  addDays,
  formatDateOnly,
  getZonedParts,
  localDateForInstant,
  localDateTimeToDate,
  localTimeForInstant,
  normalizeTime,
  parseDateOnly,
  parseInstant,
  weekdayForDateOnly
};