const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const model = require("../traningsverktyg/massagefeedback/session-model");
const sessionApi = require("../traningsverktyg/massagefeedback/session-api");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function testScaleHasTenOrderedPositions() {
  assert.deepStrictEqual(model.POSITIONS, [
    "GREAT", "GOOD", "NOT MUCH", "4", "5", "6", "7", "8", "9", "10"
  ]);
}

function testStartJoinInvalidAndFullSession() {
  const started = model.createSession("A7K2");
  assert.strictEqual(started.status, "waiting");
  assert.deepStrictEqual(started.participants, ["A"]);
  assert.strictEqual(model.joinSession(started, "wrong", "B").reason, "invalid");

  const joined = model.joinSession(started, " a7k2 ", "B");
  assert.strictEqual(joined.ok, true);
  assert.strictEqual(joined.session.status, "connected");
  assert.deepStrictEqual(joined.session.participants, ["A", "B"]);
  assert.strictEqual(model.joinSession(joined.session, "A7K2", "C").reason, "full");
}

function testSharedValueAndExclusiveDragControl() {
  let session = model.joinSession(model.createSession("B82Q"), "B82Q", "B").session;
  session = model.claimControl(session, "A").session;
  assert.strictEqual(model.claimControl(session, "B").reason, "locked");
  assert.strictEqual(model.setPosition(session, "B", 9).reason, "locked");
  session = model.setPosition(session, "A", 7).session;
  assert.strictEqual(session.position, 7);
  session = model.releaseControl(session, "A").session;
  session = model.claimControl(session, "B").session;
  session = model.setPosition(session, "B", 9).session;
  assert.strictEqual(session.position, 9);
}

function testOrientationDoesNotChangeSelectedPosition() {
  const session = { ...model.createSession("C53M"), position: 5 };
  const orientation = model.toggleOrientation("horizontal");
  assert.strictEqual(orientation, "vertical");
  assert.strictEqual(session.position, 5);
  assert.strictEqual(model.toggleOrientation(orientation), "horizontal");
}

function testLeavingAndEndingSession() {
  let session = model.joinSession(model.createSession("D8Q4"), "D8Q4", "B").session;
  session = model.leaveSession(session, "A").session;
  assert.deepStrictEqual(session.participants, ["B"]);
  assert.strictEqual(session.status, "waiting");
  session = model.endSession(session).session;
  assert.strictEqual(session.status, "ended");
  assert.strictEqual(model.joinSession(session, "D8Q4", "A").reason, "ended");
}

function testPublicSessionIntegration() {
  const toolsPage = read("workout.html");
  const page = read("traningsverktyg/massagefeedback/index.html");
  const ui = read("traningsverktyg/massagefeedback/massagefeedback.js");
  assert.match(toolsPage, /href="\/traningsverktyg\/massagefeedback\/"/);
  assert.match(page, /href="\/workout\.html">← Tillbaka till Träningsverktyg/);
  assert.doesNotMatch(page, /Ingen riktig telefonanslutning|Simulerad session/);
  assert.match(page, /id="sessionActions"/);
  assert.match(page, /data-session-connection-status="A"/);
  assert.match(page, /data-session-connection-status="B"/);
  assert.match(page, /Telefonernas anslutningsstatus/);
  assert.match(page, /session-api\.js/);
  assert.strictEqual(
    (page.match(/\/massagefeedback\/massagefeedback\.js/g) || []).length,
    1,
    "The page must load exactly one Massagefeedback application script."
  );
  const scriptReference = page.match(
    /<script src="\/traningsverktyg\/massagefeedback\/massagefeedback\.js\?v=sha256-([a-f0-9]{64})" defer><\/script>/
  );
  assert.ok(scriptReference, "Massagefeedback must load its content-versioned script URL.");
  assert.strictEqual(
    scriptReference[1],
    crypto.createHash("sha256").update(ui).digest("hex"),
    "The script URL fingerprint must match the current JavaScript contents."
  );
  assert.doesNotMatch(page, /qr-code\.js|sessionQrCode/);
  assert.doesNotMatch(ui, /qr-code\.js|MassageFeedbackQr|sessionQrCode|createSvg/);
  assert.match(page, /id="joinApprovalPanel"/);
  assert.match(page, /id="sessionCodeOutput"/);
  assert.match(page, /id="copySessionCodeButton"/);
  assert.match(page, /id="joinSessionForm"/);
  for (const method of ["createSession", "requestJoin", "decideJoin", "openEvents", "claimControl", "setPosition"]) {
    assert.match(ui, new RegExp(`api\\.${method}\\s*\\(`));
  }
  const deviceTemplate = ui.slice(
    ui.indexOf("function deviceMarkup()"),
    ui.indexOf("function setFeedbackMessage")
  );
  assert.strictEqual((deviceTemplate.match(/class="device-card"/g) || []).length, 1);
  assert.strictEqual((deviceTemplate.match(/data-feedback-slider/g) || []).length, 1);
  assert.strictEqual((deviceTemplate.match(/data-selected-position/g) || []).length, 1);
  assert.match(ui, /deviceGrid\.innerHTML = deviceMarkup\(\);/);
  assert.match(ui, /function activeDeviceId\(\)[\s\S]*DEVICE_FOR_ROLE\[state\.role\]/);
  assert.match(ui, /function refreshConnectionStatus\(\)/);
  assert.match(ui, /"connected"|"waiting"|"reconnecting"/);
  assert.match(deviceTemplate, /aria-live="polite"/);
  assert.match(deviceTemplate, /data-leave>Lämna på den här telefonen/);
  assert.match(deviceTemplate, /data-end>Avsluta för båda/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
  assert.ok(fs.existsSync(path.join(root, "traningsverktyg/massagefeedback/index.html")));
  assert.strictEqual(
    sessionApi.getDefaultBasePath({ hostname: "halsopulsen.se" }),
    "https://booking.halsopulsen.se/api/massagefeedback"
  );
  assert.strictEqual(
    sessionApi.getDefaultBasePath({ hostname: "localhost" }),
    "/api/massagefeedback",
    "Local and test environments should keep the same-origin API default."
  );
}

async function testSessionApiCredentialHeadersAndSseParsing() {
  const hostCapability = "host-capability-never-in-url";
  const guestCapability = "guest-capability-never-in-url";
  const joinTicket = "join-ticket-never-in-url";
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/sessions")) {
      return new Response(JSON.stringify({
        ok: true,
        code: "ABC234",
        capability: hostCapability,
        participant: "host",
        state: {
          code: "ABC234",
          status: "waiting",
          position: 0,
          participants: [{ role: "host", connected: false }],
          activeControl: null,
          pendingJoin: null
        }
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/join-requests")) {
      return new Response(JSON.stringify({
        ok: true,
        requestId: "request-123",
        joinTicket,
        status: "pending"
      }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/join-requests/status")) {
      return new Response(JSON.stringify({
        ok: true,
        status: "approved",
        capability: guestCapability
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/events")) {
      return new Response(
        "retry: 2000\r\n\r\nevent: state\r\ndata: {\"position\":7,\"status\":\"connected\"}\r\n\r\n",
        { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
      );
    }
    throw new Error(`Unexpected test request: ${url}`);
  };

  const api = sessionApi.createSessionApi({
    fetchImpl,
    basePath: "https://booking.halsopulsen.se/api/massagefeedback"
  });
  const host = await api.createSession();
  const join = await api.requestJoin(host.code);
  const approved = await api.getJoinStatus(host.code, join.requestId, join.joinTicket);
  const eventStream = await api.openEvents(host.code, hostCapability);
  const events = [];
  for await (const event of sessionApi.readEvents(eventStream)) events.push(event);

  assert.strictEqual(host.code, "ABC234");
  assert.strictEqual(join.joinTicket, joinTicket);
  assert.strictEqual(approved.capability, guestCapability);
  assert.deepStrictEqual(events, [{
    event: "state",
    data: { position: 7, status: "connected" }
  }]);
  assert.ok(calls.every(call =>
    !call.url.includes(hostCapability)
    && !call.url.includes(guestCapability)
    && !call.url.includes(joinTicket)
  ), "Capabilities and join tickets must never appear in request URLs.");
  assert.strictEqual(calls[2].options.headers["X-Massage-Join-Ticket"], joinTicket);
  assert.strictEqual(calls[2].options.body.includes(joinTicket), false);
  assert.strictEqual(calls[3].options.headers.Authorization, `Bearer ${hostCapability}`);
  assert.ok(
    calls.every(call => call.url.startsWith("https://booking.halsopulsen.se/api/massagefeedback/")),
    "All JSON and event-stream requests should use the configured API base URL."
  );
}

testScaleHasTenOrderedPositions();
testStartJoinInvalidAndFullSession();
testSharedValueAndExclusiveDragControl();
testOrientationDoesNotChangeSelectedPosition();
testLeavingAndEndingSession();
testPublicSessionIntegration();

(async () => {
  await testSessionApiCredentialHeadersAndSseParsing();
  console.log("Massagefeedback UI tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
