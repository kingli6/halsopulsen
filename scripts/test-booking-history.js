const assert = require("assert");
const fs = require("fs");
const { BookingError } = require("../booking/service");
const {
  listAppointmentHistory,
  listAppointments
} = require("../booking/admin-service");

const config = { timezone: "Europe/Stockholm" };
const queries = [];

function appointmentRow(id) {
  const startsAt = new Date(Date.UTC(2022, 2, 15, 10, 0) - (id - 1) * 60 * 1000);
  return {
    id,
    service_id: 3,
    client_name: `Client ${id}`,
    client_email: `client-${id}@example.test`,
    client_phone: `+460000000${String(id).padStart(2, "0")}`,
    starts_at: startsAt,
    ends_at: new Date(startsAt.getTime() + 60 * 60 * 1000),
    original_starts_at: null,
    original_ends_at: null,
    alternative_starts_at: null,
    alternative_ends_at: null,
    break_minutes_override: null,
    status: "completed",
    notes: "Test note",
    created_at: new Date(Date.UTC(2022, 1, 1, 10, 0) - id * 1000),
    updated_at: new Date(startsAt.getTime() + 60 * 60 * 1000),
    cancelled_at: null,
    service_name: "Massage",
    duration_minutes: 60,
    default_break_minutes: 10
  };
}

function makeHistoryRows(count) {
  return Array.from({ length: count }, (_, index) => appointmentRow(index + 1));
}

let historyRows = makeHistoryRows(501);

const client = {
  async query(text, params) {
    queries.push({ text, params });
    if (text.includes("CURRENT_TIMESTAMP")) {
      const limit = params.at(-2);
      const offset = params.at(-1);
      return { rows: historyRows.slice(offset, offset + limit) };
    }
    return { rows: [] };
  }
};

async function expectBookingError(promise, code) {
  await assert.rejects(promise, error => error instanceof BookingError && error.code === code);
}

async function main() {
  const pageThree = await listAppointmentHistory(client, {
    search: " CLIENT-101@Example.Test ",
    serviceId: "3",
    status: "completed",
    from: "2022-03-01",
    to: "2022-03-31",
    page: "3"
  }, config);

  assert.strictEqual(pageThree.appointments.length, 50, "History requests must return at most one page.");
  assert.strictEqual(pageThree.appointments[0].email, "client-101@example.test");
  assert.deepStrictEqual(pageThree.pagination, {
    page: 3,
    pageSize: 50,
    hasNextPage: true
  });
  const historyQuery = queries[0];
  assert(historyQuery.text.includes("CURRENT_TIMESTAMP"), "History must include only past appointments.");
  assert(historyQuery.text.includes("POSITION($1 IN LOWER(COALESCE(a.client_name, '')))"));
  assert(historyQuery.text.includes("POSITION($1 IN LOWER(COALESCE(a.client_email, '')))"));
  assert(historyQuery.text.includes("a.service_id = $2"));
  assert(historyQuery.text.includes("a.status = $3"));
  assert(/LIMIT \$6\s+OFFSET \$7/.test(historyQuery.text));
  assert(historyQuery.text.includes("a.created_at DESC, a.id DESC"), "Ordering must have a unique tie-breaker.");
  assert.deepStrictEqual(historyQuery.params.slice(0, 3), ["client-101@example.test", 3, "completed"]);
  assert.strictEqual(historyQuery.params[5], 51);
  assert.strictEqual(historyQuery.params[6], 100, "Page three must request rows after the first two pages.");

  historyRows = makeHistoryRows(100);
  const unchangedPageOne = await listAppointmentHistory(client, {}, config);
  const unchangedPageTwo = await listAppointmentHistory(client, { page: "2" }, config);
  const firstHundredIds = [...unchangedPageOne.appointments, ...unchangedPageTwo.appointments]
    .map(item => item.id);
  assert.strictEqual(new Set(firstHundredIds).size, 100, "Consecutive pages must not overlap.");
  assert.deepStrictEqual(
    firstHundredIds,
    historyRows.slice(0, 100).map(row => String(row.id)),
    "Consecutive pages must not skip any records in an unchanged result set."
  );

  historyRows = makeHistoryRows(50);
  const exactlyFifty = await listAppointmentHistory(client, {}, config);
  assert.strictEqual(exactlyFifty.appointments.length, 50);
  assert.strictEqual(exactlyFifty.pagination.hasNextPage, false, "Exactly one full page must not show a next page.");

  historyRows = makeHistoryRows(51);
  const fiftyOneFirst = await listAppointmentHistory(client, {}, config);
  const fiftyOneSecond = await listAppointmentHistory(client, { page: "2" }, config);
  assert.strictEqual(fiftyOneFirst.appointments.length, 50);
  assert.strictEqual(fiftyOneFirst.pagination.hasNextPage, true);
  assert.strictEqual(fiftyOneSecond.appointments.length, 1);
  assert.strictEqual(fiftyOneSecond.pagination.hasNextPage, false);
  assert.deepStrictEqual(
    [...fiftyOneFirst.appointments, ...fiftyOneSecond.appointments].map(item => item.id),
    historyRows.map(row => String(row.id)),
    "A 51-record result must split into one full page and one final record without overlap or skips."
  );

  historyRows = makeHistoryRows(501);
  await listAppointmentHistory(client, { page: "11" }, config);
  assert.strictEqual(queries.at(-1).params.at(-2), 51);
  assert.strictEqual(queries.at(-1).params.at(-1), 500, "Page eleven must reach records beyond the old 500-row limit.");
  const pageEleven = await listAppointmentHistory(client, { page: "11" }, config);
  assert.deepStrictEqual(
    pageEleven.appointments.map(item => item.id),
    ["501"],
    "Page eleven must return the distinct 501st matching record."
  );
  assert.strictEqual(pageEleven.pagination.hasNextPage, false);

  const callsBeforeInvalidQueries = queries.length;
  await expectBookingError(listAppointmentHistory(client, { search: "a".repeat(121) }, config), "invalid_input");
  await expectBookingError(listAppointmentHistory(client, { serviceId: "3 OR 1=1" }, config), "invalid_service");
  await expectBookingError(listAppointmentHistory(client, { status: "unknown" }, config), "invalid_status");
  await expectBookingError(listAppointmentHistory(client, { from: "2022-04-02", to: "2022-04-01" }, config), "invalid_date_range");
  await expectBookingError(listAppointmentHistory(client, { page: "0" }, config), "invalid_input");
  await expectBookingError(listAppointmentHistory(client, { page: String(Number.MAX_SAFE_INTEGER) }, config), "invalid_page");
  assert.strictEqual(queries.length, callsBeforeInvalidQueries, "Invalid filters must be rejected before querying.");

  await listAppointments(client, { from: "2026-10-23", to: "2026-12-22" }, config);
  assert(queries.at(-1).text.includes("LIMIT 500"), "The existing upcoming-bookings endpoint must keep its current limit.");
  assert(!queries.at(-1).text.includes("CURRENT_TIMESTAMP"), "The upcoming-bookings query must remain unchanged.");

  const routes = fs.readFileSync("booking/admin-routes.js", "utf8");
  assert(
    routes.indexOf('router.get("/appointments/history"')
      < routes.indexOf('router.get("/appointments/:id"'),
    "The history route must be registered before the appointment-ID route."
  );
  const server = fs.readFileSync("server.js", "utf8");
  assert(
    server.includes("app.use('/api/booking/admin', (req, res, next) => {\n  if (!readAdminSession(req))")
      && server.includes("}, bookingAdminRouter);"),
    "Booking history must remain behind the existing admin authentication."
  );

  console.log("Booking history service checks passed: filters, page boundaries, no-overlap traversal, page eleven, and unchanged upcoming query.");
}

main().catch(error => {
  console.error(`Booking history test failed: ${error.message}`);
  process.exitCode = 1;
});
