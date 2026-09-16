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
    id: "42",
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
  await email.sendConfirmedEmail({
    booking,
    token: "confirmed-token",
    personalMessage: "Välkommen!\nVi ses snart."
  });
  await email.sendAlternativeEmail({
    booking,
    token: "alternative-token",
    personalMessage: "<Ring gärna om tiden inte passar.>"
  });
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
  assert.strictEqual(deliveries[0].body.reply_to, undefined);
  assert.strictEqual(deliveries[2].body.reply_to, "halsopulsen@gmail.com");
  assert.strictEqual(deliveries[3].body.reply_to, "halsopulsen@gmail.com");
  assert.strictEqual(deliveries[4].body.reply_to, undefined);
  assert(deliveries[2].body.text.includes("Personligt meddelande från HälsoPulsen:"));
  assert(deliveries[2].body.text.includes("Välkommen!\nVi ses snart."));
  assert(deliveries[2].body.html.includes("Välkommen!<br>Vi ses snart."));
  assert(deliveries[3].body.text.includes("<Ring gärna om tiden inte passar.>"));
  assert(deliveries[3].body.html.includes("&lt;Ring gärna om tiden inte passar.&gt;"));
  assert(deliveries[1].body.text.includes("https://booking.example.test/admin/booking"));
  assert(!deliveries[0].body.attachments, "Pending client email must not include a calendar attachment.");
  assert(!deliveries[1].body.attachments, "Pending admin email must not include a calendar attachment.");
  assert(!deliveries[3].body.attachments, "Alternative proposal email must not include a calendar attachment.");

  const confirmedAttachment = deliveries[2].body.attachments?.[0];
  assert(confirmedAttachment, "Confirmed client email should include a calendar attachment.");
  assert.strictEqual(confirmedAttachment.filename, "halsopulsen-bokning.ics");
  assert.strictEqual(confirmedAttachment.content_type, "text/calendar; method=REQUEST");
  assert.strictEqual(confirmedAttachment.type, "text/calendar; method=REQUEST");
  assert.strictEqual(
    Buffer.from(confirmedAttachment.content, "base64").toString("base64"),
    confirmedAttachment.content,
    "Calendar attachment content must be valid Base64."
  );
  const confirmedIcs = Buffer.from(confirmedAttachment.content, "base64").toString("utf8");
  assert(confirmedIcs.includes("\r\n"), "iCalendar content must use CRLF line endings.");
  assert(!confirmedIcs.replace(/\r\n/g, "").includes("\n"), "iCalendar content must not contain bare LF line endings.");
  assert(confirmedIcs.includes("METHOD:REQUEST\r\n"));
  assert(confirmedIcs.includes("UID:booking-42@halsopulsen.se\r\n"));
  assert(confirmedIcs.includes("DTSTART:20990615T080000Z\r\n"));
  assert(confirmedIcs.includes("DTEND:20990615T090000Z\r\n"));
  assert(confirmedIcs.includes("STATUS:CONFIRMED\r\n"));
  assert(confirmedIcs.includes("SEQUENCE:0\r\n"));

  const cancellationAttachment = deliveries[4].body.attachments?.[0];
  assert(cancellationAttachment, "Confirmed cancellation email should include a calendar attachment.");
  assert.strictEqual(cancellationAttachment.type, "text/calendar; method=CANCEL");
  const cancellationIcs = Buffer.from(cancellationAttachment.content, "base64").toString("utf8");
  assert(cancellationIcs.includes("METHOD:CANCEL\r\n"));
  assert(cancellationIcs.includes("STATUS:CANCELLED\r\n"));
  assert(cancellationIcs.includes("UID:booking-42@halsopulsen.se\r\n"));

  const updatedBooking = bookingFixture({
    id: "84",
    startsAt: new Date("2099-06-16T10:00:00Z"),
    endsAt: new Date("2099-06-16T11:00:00Z")
  });
  await email.sendConfirmedEmail({ booking: updatedBooking, token: "accepted-token" });
  assert.strictEqual(deliveries[5].body.reply_to, "halsopulsen@gmail.com");
  assert(!deliveries[5].body.text.includes("Personligt meddelande från HälsoPulsen:"));
  const acceptedIcs = Buffer.from(deliveries[5].body.attachments[0].content, "base64").toString("utf8");
  assert(acceptedIcs.includes("DTSTART:20990616T100000Z\r\n"), "Accepted alternatives must use the accepted start time.");
  assert(acceptedIcs.includes("DTEND:20990616T110000Z\r\n"), "Accepted alternatives must use the accepted end time.");

  await email.sendAdminConfirmedEmail({ booking: updatedBooking });
  assert.strictEqual(deliveries[6].body.to[0], "admin@example.com");
  assert.strictEqual(deliveries[6].body.attachments[0].type, "text/calendar; method=REQUEST");

  await email.sendRescheduledEmail({ booking: updatedBooking, sequence: 7 });
  const rescheduledIcs = Buffer.from(deliveries[7].body.attachments[0].content, "base64").toString("utf8");
  assert(rescheduledIcs.includes("UID:booking-84@halsopulsen.se\r\n"));
  assert(rescheduledIcs.includes("SEQUENCE:7\r\n"));

  const noCalendarBooking = bookingFixture({
    id: "85",
    startsAt: null,
    endsAt: null
  });
  await email.sendCancelledEmail({ booking: noCalendarBooking });
  assert(!deliveries[8].body.attachments, "A pending cancellation must not include a calendar attachment.");

  await email.sendAlternativeEmail({
    booking,
    token: "empty-alternative-token",
    personalMessage: "   "
  });
  assert.strictEqual(deliveries[9].body.reply_to, "halsopulsen@gmail.com");
  assert(!deliveries[9].body.text.includes("Personligt meddelande från HälsoPulsen:"));
  assert(!deliveries[9].body.html.includes("Personligt meddelande från HälsoPulsen:"));

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
    sendAdminConfirmedEmail: deliverySpy("admin_confirmed"),
    sendCancelledEmail: deliverySpy("cancelled"),
    sendAdminCancelledEmail: deliverySpy("admin_cancelled"),
    sendRescheduledEmail: deliverySpy("rescheduled"),
    sendAdminRescheduledEmail: deliverySpy("admin_rescheduled")
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
    deleteCancelledAppointment: async () => ({ id: "3" }),
    getAppointment: async (_pool, id) => String(id) === "4" ? confirmedBooking : ({}),
    listAppointments: async () => [],
    listBlockedTimes: async () => [],
    listOverrides: async () => [],
    listRules: async () => [],
    listServices: async () => [],
    updateAppointment: async () => ({ status: "pending" }),
    updateConfirmedAppointment: async () => confirmedBooking,
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
    body: {
      action: "suggest_alternative",
      personalMessage: "Kan den föreslagna tiden passa?"
    }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.ok, true);
  assert.strictEqual(calls[2].name, "alternative");
  assert.strictEqual(calls[2].args.personalMessage, "Kan den föreslagna tiden passa?");

  response = await invokeRoute(bookingAdminRouter, "patch", "/appointments/:id", {
    params: { id: "2" },
    body: {
      status: "confirmed",
      personalMessage: "Din tid är bokad. Välkommen!"
    }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.appointment.status, "confirmed");
  assert.strictEqual(calls[3].name, "confirmed");
  assert.strictEqual(calls[3].args.personalMessage, "Din tid är bokad. Välkommen!");
  assert.strictEqual(calls[4].name, "admin_confirmed");
  assert.strictEqual(calls[4].args.personalMessage, undefined);

  response = await invokeRoute(bookingAdminRouter, "patch", "/appointments/:id", {
    params: { id: "3" },
    body: { status: "cancelled" }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.appointment.status, "cancelled");
  assert.strictEqual(calls[5].name, "cancelled");
  assert.strictEqual(calls[6].name, "admin_cancelled");

  response = await invokeRoute(bookingAdminRouter, "patch", "/appointments/:id", {
    params: { id: "3" },
    body: { status: "pending" }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.appointment.status, "pending");
  assert.strictEqual(calls.length, 7, "Reactivation must not send an email.");

  response = await invokeRoute(bookingAdminRouter, "delete", "/appointments/:id", {
    params: { id: "3" }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.appointment.id, "3");
  assert.strictEqual(calls.length, 7, "Deleting must not send an email.");

  response = await invokeRoute(bookingAdminRouter, "patch", "/appointments/:id", {
    params: { id: "4" },
    body: { date: "2099-06-16", start: "12:00", status: "confirmed" }
  });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.appointment.status, "confirmed");
  assert.strictEqual(calls[7].name, "rescheduled");
  assert.strictEqual(calls[8].name, "admin_rescheduled");

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
  assert.strictEqual(calls[9].name, "confirmed");
  assert.strictEqual(calls[10].name, "admin_confirmed");
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