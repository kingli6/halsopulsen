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
  return {
    id,
    service_id: 3,
    client_name: "Ada Lovelace",
    client_email: "ada@example.test",
    client_phone: "+46000000000",
    starts_at: new Date("2022-03-15T09:00:00.000Z"),
    ends_at: new Date("2022-03-15T10:00:00.000Z"),
    original_starts_at: null,
    original_ends_at: null,
    alternative_starts_at: null,
    alternative_ends_at: null,
    break_minutes_override: null,
    status: "completed",
    notes: "Test note",
    created_at: new Date("2022-02-01T10:00:00.000Z"),
    updated_at: new Date("2022-03-15T10:00:00.000Z"),
    cancelled_at: null,
    service_name: "Massage",
    duration_minutes: 60,
    default_break_minutes: 10
  };
}

const client = {
  async query(text, params) {
    queries.push({ text, params });
    if (text.includes("CURRENT_TIMESTAMP")) {
      return { rows: Array.from({ length: 51 }, (_, index) => appointmentRow(index + 1)) };
    }
    return { rows: [] };
  }
};

async function expectBookingError(promise, code) {
  await assert.rejects(promise, error => error instanceof BookingError && error.code === code);
}

async function main() {
  const pageThree = await listAppointmentHistory(client, {
    search: " Ada@Example.Test ",
    serviceId: "3",
    status: "completed",
    from: "2022-03-01",
    to: "2022-03-31",
    page: "3"
  }, config);

  assert.strictEqual(pageThree.appointments.length, 50, "History requests must return at most one page.");
  assert.strictEqual(pageThree.appointments[0].email, "ada@example.test");
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
  assert.deepStrictEqual(historyQuery.params.slice(0, 3), ["ada@example.test", 3, "completed"]);
  assert.strictEqual(historyQuery.params[5], 51);
  assert.strictEqual(historyQuery.params[6], 100, "Page three must request rows after the first two pages.");

  await listAppointmentHistory(client, { page: "11" }, config);
  assert.strictEqual(queries[1].params[0], 51);
  assert.strictEqual(queries[1].params[1], 500, "History pagination must reach records beyond the old 500-row limit.");

  const pageOne = await listAppointmentHistory(client, {}, config);
  assert.strictEqual(pageOne.appointments.length, 50);
  assert.deepStrictEqual(pageOne.pagination, {
    page: 1,
    pageSize: 50,
    hasNextPage: true
  });
  assert.strictEqual(queries[2].params[0], 51);
  assert.strictEqual(queries[2].params[1], 0);

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

  console.log("Booking history service checks passed: search, filters, bounded pagination, validation, and unchanged upcoming query.");
}

main().catch(error => {
  console.error(`Booking history test failed: ${error.message}`);
  process.exitCode = 1;
});
