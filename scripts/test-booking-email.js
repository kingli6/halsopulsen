const assert = require("assert");

const EMAIL_ENV_KEYS = [
  "BOOKING_EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "BOOKING_FROM_EMAIL",
  "BOOKING_ADMIN_EMAIL",
  "BOOKING_PUBLIC_URL"
];

for (const key of EMAIL_ENV_KEYS) {
  delete process.env[key];
}
process.env.BOOKING_EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "test-key-placeholder";
process.env.BOOKING_FROM_EMAIL = "bookings@example.com";
process.env.BOOKING_ADMIN_EMAIL = "admin@example.com";
process.env.BOOKING_PUBLIC_URL = "https://booking.example.test/";

const email = require("../booking/email");

function responseOk() {
  return {
    ok: true,
    status: 200,
    text: async () => ""
  };
}

function bookingFixture(overrides = {}) {
  return {
    clientName: "Anna Andersson",
    clientEmail: "anna@example.com",
    clientPhone: "070-123 45 67",
    serviceName: "Personlig träning",
    durationMinutes: 60,
    startsAt: new Date("2099-06-15T08:00:00Z"),
    endsAt: new Date("2099-06-15T09:00:00Z"),
    originalStartsAt: new Date("2099-06-15T08:00:00Z"),
    originalEndsAt: new Date("2099-06-15T09:00:00Z"),
    alternativeStartsAt: new Date("2099-06-16T10:00:00Z"),
    alternativeEndsAt: new Date("2099-06-16T11:00:00Z"),
    ...overrides
  };
}

async function testEmailConfigurationAndPayloads() {
  for (const key of [
    "RESEND_API_KEY",
    "BOOKING_FROM_EMAIL",
    "BOOKING_ADMIN_EMAIL",
    "BOOKING_PUBLIC_URL"
  ]) {
    delete process.env[key];
  }
  const incomplete = email.getEmailConfiguration();
  assert.strictEqual(incomplete.configured, false);
  assert.deepStrictEqual(incomplete.missing, [
    "RESEND_API_KEY",
    "BOOKING_FROM_EMAIL",
    "BOOKING_ADMIN_EMAIL",
    "BOOKING_PUBLIC_URL"
  ]);
  assert(!JSON.stringify(incomplete).includes("test-key-placeholder"));

  process.env.RESEND_API_KEY = "test-key-placeholder";
  process.env.BOOKING_FROM_EMAIL = "bookings@example.com";
  process.env.BOOKING_ADMIN_EMAIL = "admin@example.com";
  process.env.BOOKING_PUBLIC_URL = "https://booking.example.test/";
  const configured = email.getEmailConfiguration();
  assert.strictEqual(configured.configured, true);
  assert(!Object.prototype.hasOwnProperty.call(configured, "RESEND_API_KEY"));

  const deliveries = [];
  global.fetch = async (url, options) => {
    deliveries.push({
      url,
      body: JSON.parse(options.body)
    });
    return responseOk();
  };

  const booking = bookingFixture();
  await email.sendRequestReceivedEmail({ booking, token: "request-token" });
  await email.sendNewRequestAdminEmail({ booking });
  await email.sendConfirmedEmail({ booking, token: "confirmed-token" });
  await email.sendAlternativeEmail({ booking, token: "alternative-token" });
  await email.sendCancelledEmail({ booking });

  assert.strictEqual(deliveries.length, 5);
  assert(deliveries.every(item => item.url === "https://api.resend.com/emails"));
  assert.deepStrictEqual(
    deliveries.map(item => item.body.subject),
    [
      "Din bokningsförfrågan har tagits emot · HälsoPulsen",
      "Ny bokningsförfrågan · Anna Andersson",
      "Din tid är bekräftad · HälsoPulsen",
      "Förslag på en annan tid · HälsoPulsen",
      "Bokningsförfrågan avslutad · HälsoPulsen"
    ]
  );

  const clientMessages = deliveries.filter(item => item.body.to[0] === "anna@example.com");
  assert.strictEqual(clientMessages.length, 4);
  for (const message of clientMessages.slice(0, 3)) {
    assert(message.body.text.includes("https://booking.example.test/"));
    assert(!message.body.text.includes("https://api.resend.com/"));
  }
  assert(
    deliveries[0].body.text.includes(
      "https://booking.example.test/booking/manage/request-token"
    )
  );
  assert(
    deliveries[2].body.text.includes(
      "https://booking.example.test/booking/manage/confirmed-token"
    )
  );
  assert(
    deliveries[3].body.text.includes(
      "https://booking.example.test/booking/manage/alternative-token"
    )
  );
  assert(deliveries[1].body.text.includes("https://booking.example.test/admin/booking"));

  let fixtureDeliveryAttempted = false;
  global.fetch = async () => {
    fixtureDeliveryAttempted = true;
    throw new Error("Fixture email should have been suppressed.");
  };
  const fixtureResult = await email.sendCancelledEmail({
    booking: bookingFixture({ clientEmail: "fixture@example.test" })
  });
  assert.deepStrictEqual(fixtureResult, { sent: false, reason: "test_fixture" });
  assert.strictEqual(fixtureDeliveryAttempted, false);
  assert.strictEqual(email.isTestFixtureEmail("fixture@example.test"), true);
  assert.strictEqual(email.isTestFixtureEmail("client@example.com"), false);
}

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports
  };
}

function findRoute(router, method, path) {
  const layer = router.stack.find(item =>
    item.route &&
    item.route.path === path &&
    item.route.methods[method.toLowerCase()]
  );
  assert(layer, `Could not find ${method.toUpperCase()} ${path}.`);
  return layer.route.stack[0].handle;
}

async function invokeRoute(router, method, path, {
  params = {},
  body = {},
  query = {}
} = {}) {
  const handler = findRoute(router, method, path);
  const result = {
    statusCode: 200,
    body: undefined
  };
  const response = {
    status(code) {
      result.statusCode = code;
      return response;
    },
    json(bodyValue) {
      result.body = bodyValue;
      return response;
    }
  };
  await handler({ params, body, query }, response, error => {
    throw error;
  });
  return result;
}

async function waitForBackgroundWork() {
  await new Promise(resolve => setImmediate(resolve));
}

async function testRouteTriggersAndProviderFailure() {
  const calls = [];
  const requestBooking = bookingFixture({
    clientEmail: "request@example.com",
    actionToken: "request-action-token",
    status: "pending"
  });
  const alternativeBooking = bookingFixture({
    clientEmail: "alternative@example.com",
    status: "alternative_suggested"
  });
  const confirmedBooking = bookingFixture({
    clientEmail: "confirmed@example.com",
    status: "confirmed"
  });
  const cancelledBooking = bookingFixture({
    clientEmail: "cancelled@example.com",
    status: "cancelled"
  });
  const acceptedBooking = bookingFixture({
    clientEmail: "accepted@example.com",
    status: "confirmed"
  });

  const deliverySpy = (name, result = { sent: true }) => async args => {
    calls.push({ name, args });
    return result;
  };
  const emailMock = {
    ...email,
    sendRequestReceivedEmail: deliverySpy("request"),
    sendNewRequestAdminEmail: deliverySpy("admin_request"),
    sendAlternativeEmail: deliverySpy("alternative"),
    sendConfirmedEmail: async args => {
      calls.push({ name: "confirmed", args });
      if (args.booking.clientEmail === acceptedBooking.clientEmail) {
        return email.sendConfirmedEmail(args);
      }
      return { sent: true };
    },
    sendCancelledEmail: deliverySpy("cancelled")
  };

  mockModule("../booking/email", emailMock);
  mockModule("../booking/db", { getPool: () => ({}) });
  mockModule("../booking/service", {
    BookingError: class BookingError extends Error {},
    createBookingRequest: async () => requestBooking,
    listActiveServices: async () => [],
    publicService: service => service,
    calculateAvailability: async () => ({})
  });
  mockModule("../booking/admin-service", {
    calendarEvents: async () => ({}),
    createBlockedTime: async () => ({}),
    createOverride: async () => ({}),
    createRule: async () => ({}),
    createService: async () => ({}),
    getAppointment: async () => ({}),
    listAppointments: async () => [],
    listBlockedTimes: async () => [],
    listOverrides: async () => [],
    listRules: async () => [],
    listServices: async () => [],
     updateAppointment: async () => ({ status: "pending" }),
    updateBlockedTime: async () => ({}),
    updateOverride: async () => ({}),
    updateRule: async () => ({}),
    updateService: async () => ({})
  });
  mockModule("../booking/workflow-service", {
    cancelAppointment: async () => ({ booking: cancelledBooking }),
    confirmAppointment: async () => ({
      booking: confirmedBooking,
      actionToken: "confirmed-action-token"
    }),
    suggestAlternative: async () => ({
      booking: alternativeBooking,
      actionToken: "alternative-action-token"
    }),
    acceptAlternative: async () => ({
      booking: acceptedBooking,
      actionToken: "accepted-action-token"
    }),
    cancelByToken: async () => ({ booking: cancelledBooking }),
    declineAlternative: async () => ({ booking: cancelledBooking }),
    getClientAction: async () => ({ status: "pending" })
  });

  const { bookingRouter } = require("../booking/routes");
  const { bookingAdminRouter } = require("../booking/admin-routes");
  const { bookingActionRouter } = require("../booking/action-routes");

  let response = await invokeRoute(bookingRouter, "post", "/requests", {
    body: { email: requestBooking.clientEmail }
  });
  assert.strictEqual(response.statusCode, 201);
  assert.strictEqual(response.body.ok, true);
  assert.strictEqual(response.body.status, "pending");
  await waitForBackgroundWork();
  assert.deepStrictEqual(calls.slice(0, 2).map(call => call.name), [
    "request",
    "admin_request"
  ]);

  response = await invokeRoute(bookingAdminRouter, "patch", "/appointments/:id", {
    params: { id: "1" },
    body: { action: "suggest_alternative" }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.ok, true);
  assert.strictEqual(calls[2].name, "alternative");

  response = await invokeRoute(bookingAdminRouter, "patch", "/appointments/:id", {
    params: { id: "2" },
    body: { status: "confirmed" }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.appointment.status, "confirmed");
  assert.strictEqual(calls[3].name, "confirmed");

  response = await invokeRoute(bookingAdminRouter, "patch", "/appointments/:id", {
    params: { id: "3" },
    body: { status: "cancelled" }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.appointment.status, "cancelled");
  assert.strictEqual(calls[4].name, "cancelled");

   response = await invokeRoute(bookingAdminRouter, "patch", "/appointments/:id", {
     params: { id: "3" },
     body: { status: "pending" }
   });
   assert.strictEqual(response.statusCode, 200);
   assert.strictEqual(response.body.appointment.status, "pending");
   assert.strictEqual(calls.length, 5, "Reactivation must not send an email.");

  global.fetch = async () => ({
    ok: false,
    status: 422,
    text: async () => "invalid provider response"
  });
  const originalConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args.join(" "));
  try {
    response = await invokeRoute(bookingActionRouter, "post", "/:token/accept", {
      params: { token: "alternative-action-token" }
    });
    await waitForBackgroundWork();
  } finally {
    console.error = originalConsoleError;
  }
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.ok, true);
  assert.strictEqual(response.body.status, "confirmed");
  assert(loggedErrors.some(message => message.includes("Booking confirmation email failed")));
  assert.strictEqual(calls[5].name, "confirmed");
}

async function main() {
  await testEmailConfigurationAndPayloads();
  await testRouteTriggersAndProviderFailure();
  console.log("Booking email regression checks passed: configuration detection, Swedish templates, public links, fixture suppression, all workflow triggers, and provider-failure isolation.");
}

main().catch(error => {
  console.error(`Booking email regression test failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});