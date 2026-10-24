const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const {
  createMassageFeedbackRouter,
  isHighFrequencyPositionRequest
} = require("../traningsverktyg/massagefeedback/api-router");
const { createSessionService } = require("../traningsverktyg/massagefeedback/session-service");

const root = path.join(__dirname, "..");

async function startServer(router = createMassageFeedbackRouter()) {
  const app = express();
  app.use(express.json({ limit: "512kb", strict: true }));
  app.get("/api/booking/services", (_req, res) => res.json({ ok: true, services: [] }));
  app.use("/api/massagefeedback", router);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    router,
    baseUrl: `http://127.0.0.1:${address.port}/api/massagefeedback`,
    async close() {
      router.close();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

async function request(baseUrl, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.capability) headers.Authorization = `Bearer ${options.capability}`;
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  return { response, payload };
}

function api(baseUrl) {
  return {
    baseUrl,
    post: (route, body = {}, capability, headers) => request(baseUrl, route, {
      method: "POST",
      body,
      capability,
      headers
    }),
    get: (route, capability, options = {}) => request(baseUrl, route, {
      method: "GET",
      capability,
      ...options
    })
  };
}

async function createHost(client) {
  const { response, payload } = await client.post("/sessions");
  assert.strictEqual(response.status, 201);
  assert.match(payload.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.strictEqual(Buffer.from(payload.capability, "base64url").length, 32);
  assert.strictEqual(payload.participant, "host");
  assert.strictEqual(payload.state.position, 0);
  assert.ok(!response.url.includes(payload.capability), "Capability must not appear in a URL.");
  return payload;
}

async function createApprovedGuest(client, host) {
  const joined = await client.post("/join-requests", { code: host.code });
  assert.strictEqual(joined.response.status, 202);
  assert.strictEqual(joined.payload.status, "pending");
  const pending = await client.post(
    `/sessions/${host.code}/join-requests/${joined.payload.requestId}/decision`,
    { decision: "approve" },
    host.capability
  );
  assert.strictEqual(pending.response.status, 200);
  const status = await client.post(
    "/join-requests/status",
    { code: host.code, requestId: joined.payload.requestId },
    null,
    { "X-Massage-Join-Ticket": joined.payload.joinTicket }
  );
  assert.strictEqual(status.payload.status, "approved");
  assert.strictEqual(Buffer.from(status.payload.capability, "base64url").length, 32);
  return { ...joined.payload, capability: status.payload.capability };
}

async function nextSseEvent(reader, streamState) {
  while (true) {
    const boundary = streamState.buffer.indexOf("\n\n");
    if (boundary !== -1) {
      const block = streamState.buffer.slice(0, boundary);
      streamState.buffer = streamState.buffer.slice(boundary + 2);
      const event = block.match(/^event: (.+)$/m)?.[1] || "message";
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (data) return { event, data: JSON.parse(data) };
      continue;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("SSE stream closed before the expected event.");
    streamState.buffer += new TextDecoder().decode(value, { stream: true });
  }
}

async function nextSseEventMatching(reader, streamState, matches) {
  while (true) {
    const event = await nextSseEvent(reader, streamState);
    if (matches(event)) return event;
  }
}

async function openEvents(client, code, capability) {
  const controller = new AbortController();
  const response = await fetch(`${client.baseUrl}/sessions/${code}/events`, {
    headers: { Authorization: `Bearer ${capability}` },
    signal: controller.signal
  });
  assert.strictEqual(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  return {
    reader: response.body.getReader(),
    state: { buffer: "" },
    close: async () => {
      controller.abort();
    }
  };
}

async function testApprovalAuthorizationAndSynchronizedSlider() {
  const server = await startServer();
  const client = api(server.baseUrl);
  let hostStream;
  let guestStream;
  let reconnectedHostStream;
  try {
    const host = await createHost(client);
    const invalid = await client.get(`/sessions/${host.code}`, "invalid-capability-value-that-is-long-enough");
    assert.strictEqual(invalid.response.status, 401);
    const unauthenticatedStream = await fetch(`${server.baseUrl}/sessions/${host.code}/events`);
    assert.strictEqual(unauthenticatedStream.status, 401);

    hostStream = await openEvents(client, host.code, host.capability);
    const initialHostEvent = await nextSseEvent(hostStream.reader, hostStream.state);
    assert.strictEqual(initialHostEvent.event, "state");
    assert.strictEqual(initialHostEvent.data.position, 0);

    const guest = await createApprovedGuest(client, host);
    const joinNotification = await nextSseEventMatching(
      hostStream.reader,
      hostStream.state,
      event => event.event === "join-request"
    );
    assert.strictEqual(joinNotification.data.pendingJoin.requestId, guest.requestId);
    const guestRead = await client.get(`/sessions/${host.code}`, guest.capability);
    assert.strictEqual(guestRead.response.status, 200);
    assert.deepStrictEqual(
      guestRead.payload.state.participants.map(participant => participant.role),
      ["host", "guest"]
    );
    const heartbeat = await client.post(`/sessions/${host.code}/heartbeat`, {}, host.capability);
    assert.strictEqual(heartbeat.response.status, 200);
    const invalidHeartbeat = await client.post(
      `/sessions/${host.code}/heartbeat`,
      {},
      "invalid-capability-value-that-is-long-enough"
    );
    assert.strictEqual(invalidHeartbeat.response.status, 401);
    const repeatedStatus = await client.post(
      "/join-requests/status",
      { code: host.code, requestId: guest.requestId },
      null,
      { "X-Massage-Join-Ticket": guest.joinTicket }
    );
    assert.strictEqual(repeatedStatus.payload.capability, undefined, "The guest capability is released after guest authentication.");

    guestStream = await openEvents(client, host.code, guest.capability);
    const guestInitialEvent = await nextSseEvent(guestStream.reader, guestStream.state);
    assert.strictEqual(guestInitialEvent.data.position, 0);

    const simultaneousClaims = await Promise.all([
      client.post(`/sessions/${host.code}/control/claim`, {}, host.capability),
      client.post(`/sessions/${host.code}/control/claim`, {}, guest.capability)
    ]);
    assert.deepStrictEqual(
      simultaneousClaims.map(result => result.response.status).sort(),
      [200, 409]
    );
    const holderCapability = simultaneousClaims[0].response.status === 200
      ? host.capability
      : guest.capability;
    const competitorCapability = holderCapability === host.capability ? guest.capability : host.capability;
    const holderRole = holderCapability === host.capability ? "host" : "guest";
    const holderStream = holderRole === "host" ? hostStream : guestStream;
    const competitorStream = holderRole === "host" ? guestStream : hostStream;
    const holderReaderState = holderRole === "host" ? hostStream.state : guestStream.state;
    const competitorReaderState = holderRole === "host" ? guestStream.state : hostStream.state;
    const claimOnHolderStream = await nextSseEventMatching(
      holderStream.reader,
      holderReaderState,
      event => event.data.activeControl === holderRole
    );
    const claimOnCompetitorStream = await nextSseEventMatching(
      competitorStream.reader,
      competitorReaderState,
      event => event.data.activeControl === holderRole
    );
    assert.strictEqual(claimOnHolderStream.data.activeControl, holderRole);
    assert.strictEqual(claimOnCompetitorStream.data.activeControl, holderRole);

    const competingPosition = await client.post(
      `/sessions/${host.code}/position`,
      { position: 4 },
      competitorCapability
    );
    assert.strictEqual(competingPosition.response.status, 409);
    const outOfRangePosition = await client.post(
      `/sessions/${host.code}/position`,
      { position: 10 },
      holderCapability
    );
    assert.strictEqual(outOfRangePosition.response.status, 400);
    const update = await client.post(
      `/sessions/${host.code}/position`,
      { position: 7 },
      holderCapability
    );
    assert.strictEqual(update.response.status, 200);
    const holderUpdate = await nextSseEventMatching(
      holderStream.reader,
      holderReaderState,
      event => event.data.position === 7
    );
    const competitorUpdate = await nextSseEventMatching(
      competitorStream.reader,
      competitorReaderState,
      event => event.data.position === 7
    );
    assert.strictEqual(holderUpdate.data.position, 7);
    assert.strictEqual(competitorUpdate.data.position, 7);

    const released = await client.post(
      `/sessions/${host.code}/control/release`,
      {},
      holderCapability
    );
    assert.strictEqual(released.response.status, 200);
    const handoff = await client.post(
      `/sessions/${host.code}/control/claim`,
      {},
      competitorCapability
    );
    assert.strictEqual(handoff.response.status, 200);
    const handedUpdate = await client.post(
      `/sessions/${host.code}/position`,
      { position: 9 },
      competitorCapability
    );
    assert.strictEqual(handedUpdate.response.status, 200);
    const otherDeviceUpdate = await nextSseEventMatching(
      competitorStream.reader,
      competitorReaderState,
      event => event.data.position === 9
    );
    const initiatorUpdate = await nextSseEventMatching(
      holderStream.reader,
      holderReaderState,
      event => event.data.position === 9
    );
    assert.strictEqual(otherDeviceUpdate.data.position, 9);
    assert.strictEqual(initiatorUpdate.data.position, 9);

    await hostStream.close();
    const disconnectedUpdate = await nextSseEventMatching(
      guestStream.reader,
      guestStream.state,
      event => event.data.participants.some(participant => participant.role === "host" && !participant.connected)
    );
    assert.strictEqual(
      disconnectedUpdate.data.participants.find(participant => participant.role === "host").connected,
      false
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    reconnectedHostStream = await openEvents(client, host.code, host.capability);
    const reconnectSnapshot = await nextSseEvent(reconnectedHostStream.reader, reconnectedHostStream.state);
    assert.strictEqual(reconnectSnapshot.data.position, 9);
    assert.strictEqual(reconnectSnapshot.data.participants.length, 2);

    const ended = await client.post(`/sessions/${host.code}/end`, {}, competitorCapability);
    assert.strictEqual(ended.response.status, 200, "Either authorized participant may end the session.");
    const endEvent = await nextSseEventMatching(
      reconnectedHostStream.reader,
      reconnectedHostStream.state,
      event => event.event === "session-ended"
    );
    assert.strictEqual(endEvent.event, "session-ended");
    const hostStreamEnd = await reconnectedHostStream.reader.read();
    assert.strictEqual(hostStreamEnd.done, true);
    const guestEndEvent = await nextSseEventMatching(
      guestStream.reader,
      guestStream.state,
      event => event.event === "session-ended"
    );
    assert.strictEqual(guestEndEvent.event, "session-ended");
    const guestStreamEnd = await guestStream.reader.read();
    assert.strictEqual(guestStreamEnd.done, true);
    const hostAfterEnd = await client.get(`/sessions/${host.code}`, host.capability);
    const guestAfterEnd = await client.get(`/sessions/${host.code}`, guest.capability);
    assert.strictEqual(hostAfterEnd.response.status, 401);
    assert.strictEqual(guestAfterEnd.response.status, 401);
    await guestStream.close();
  } finally {
    if (hostStream) await hostStream.close();
    if (guestStream) await guestStream.close();
    if (reconnectedHostStream) await reconnectedHostStream.close();
    await server.close();
  }
}

async function testJoinRejectionAndConcurrentCapacity() {
  const server = await startServer();
  const client = api(server.baseUrl);
  try {
    const rejectedHost = await createHost(client);
    const rejectedRequest = await client.post("/join-requests", { code: rejectedHost.code });
    const rejected = await client.post(
      `/sessions/${rejectedHost.code}/join-requests/${rejectedRequest.payload.requestId}/decision`,
      { decision: "reject" },
      rejectedHost.capability
    );
    assert.strictEqual(rejected.response.status, 200);
    const rejectedStatus = await client.post(
      "/join-requests/status",
      { code: rejectedHost.code, requestId: rejectedRequest.payload.requestId },
      null,
      { "X-Massage-Join-Ticket": rejectedRequest.payload.joinTicket }
    );
    assert.strictEqual(rejectedStatus.payload.status, "rejected");
    assert.strictEqual(rejectedStatus.payload.capability, undefined);

    const host = await createHost(client);
    const attempts = await Promise.all(Array.from({ length: 8 }, () =>
      client.post("/join-requests", { code: host.code })
    ));
    const accepted = attempts.filter(result => result.response.status === 202);
    assert.strictEqual(accepted.length, 1, "Only one simultaneous request may reserve the guest slot.");
    assert.strictEqual(attempts.filter(result => result.response.status === 404).length, 7);

    const unauthorizedDecision = await client.post(
      `/sessions/${host.code}/join-requests/${accepted[0].payload.requestId}/decision`,
      { decision: "approve" },
      "invalid-capability-value-that-is-long-enough"
    );
    assert.strictEqual(unauthorizedDecision.response.status, 401);
    const approved = await client.post(
      `/sessions/${host.code}/join-requests/${accepted[0].payload.requestId}/decision`,
      { decision: "approve" },
      host.capability
    );
    assert.strictEqual(approved.response.status, 200);
    const thirdDevice = await client.post("/join-requests", { code: host.code });
    assert.strictEqual(thirdDevice.response.status, 404);
  } finally {
    await server.close();
  }
}

async function testValidationRateLimitsAndExistingRouteIsolation() {
  const router = createMassageFeedbackRouter({
    rateLimits: {
      create: { windowMs: 60_000, max: 1 },
      position: { windowMs: 60_000, max: 4 }
    }
  });
  const server = await startServer(router);
  const client = api(server.baseUrl);
  try {
    const booking = await fetch(`http://127.0.0.1:${new URL(server.baseUrl).port}/api/booking/services`);
    assert.deepStrictEqual(await booking.json(), { ok: true, services: [] });

    const host = await createHost(client);
    const throttledCreate = await client.post("/sessions");
    assert.strictEqual(throttledCreate.response.status, 429);
    const joinWithMalformedBody = await client.post("/join-requests", { code: 12 });
    assert.strictEqual(joinWithMalformedBody.response.status, 400);
    const noLease = await client.post(`/sessions/${host.code}/position`, { position: 1 }, host.capability);
    assert.strictEqual(noLease.response.status, 409);

    const claim = await client.post(`/sessions/${host.code}/control/claim`, {}, host.capability);
    assert.strictEqual(claim.response.status, 200);
    const first = await client.post(`/sessions/${host.code}/position`, { position: 1 }, host.capability);
    const second = await client.post(`/sessions/${host.code}/position`, { position: 2 }, host.capability);
    const third = await client.post(`/sessions/${host.code}/position`, { position: 3 }, host.capability);
    const fourth = await client.post(`/sessions/${host.code}/position`, { position: 4 }, host.capability);
    assert.strictEqual(first.response.status, 200);
    assert.strictEqual(second.response.status, 200);
    assert.strictEqual(third.response.status, 200);
    assert.strictEqual(fourth.response.status, 429);

    assert.strictEqual(isHighFrequencyPositionRequest({
      method: "POST",
      originalUrl: `/api/massagefeedback/sessions/${host.code}/position`
    }), true);
    assert.strictEqual(isHighFrequencyPositionRequest({
      method: "POST",
      originalUrl: `/api/massagefeedback/sessions/${host.code}/end`
    }), false);
    assert.strictEqual(isHighFrequencyPositionRequest({
      method: "GET",
      originalUrl: `/api/massagefeedback/sessions/${host.code}/position`
    }), false);

    const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
    assert.match(serverSource, /if \(isHighFrequencyPositionRequest\(req\)\) return next\(\);[\s\S]*apiRateLimiter\(req, res, next\);/);
    assert.match(serverSource, /if \(isHighFrequencyPositionRequest\(req\)\) return next\(\);[\s\S]*mutationRateLimiter\(req, res, next\);/);
    assert.ok(serverSource.includes("app.use('/api/massagefeedback', massageFeedbackRouter);"));
    assert.ok(serverSource.includes("app.use('/api/booking', bookingRouter);"));
  } finally {
    await server.close();
  }
}

function fakeResponse() {
  const EventEmitter = require("events");
  const response = new EventEmitter();
  response.headers = {};
  response.chunks = [];
  response.destroyed = false;
  response.writableEnded = false;
  response.status = status => {
    response.statusCode = status;
    return response;
  };
  response.setHeader = (key, value) => {
    response.headers[key] = value;
  };
  response.write = chunk => {
    response.chunks.push(chunk);
    return true;
  };
  response.flushHeaders = () => {};
  response.end = () => {
    response.writableEnded = true;
    response.emit("close");
  };
  return response;
}

function testLifecycleLeasesAndCleanup() {
  let clock = 1_000;
  const service = createSessionService({
    now: () => clock,
    idleTimeoutMs: 100,
    maximumAgeMs: 1_000,
    reconnectGraceMs: 50,
    joinRequestTimeoutMs: 20,
    dragLeaseMs: 10,
    sweepIntervalMs: 60_000,
    streamHeartbeatMs: 60_000
  });
  try {
    const host = service.create();
    const pending = service.requestJoin(host.code);
    clock += 20;
    service.sweep();
    assert.strictEqual(service.getJoinStatus(host.code, pending.requestId, pending.joinTicket).status, "expired");

    const join = service.requestJoin(host.code);
    service.decideJoin(host.code, join.requestId, "approve");
    const guest = service.getJoinStatus(host.code, join.requestId, join.joinTicket);
    assert.ok(guest.capability);
    const hostAuth = service.authorize(host.code, host.capability);
    const guestAuth = service.authorize(host.code, guest.capability);
    assert.ok(hostAuth.ok && guestAuth.ok);
    assert.strictEqual(service.heartbeat(hostAuth.session, "host").ok, true);

    assert.strictEqual(service.claimControl(hostAuth.session, "host").ok, true);
    assert.strictEqual(service.claimControl(guestAuth.session, "guest").reason, "locked");
    clock += 11;
    service.sweep();
    assert.strictEqual(service.claimControl(guestAuth.session, "guest").ok, true, "Expired leases must hand off control.");
    assert.strictEqual(service.setPosition(guestAuth.session, "guest", 10).reason, "invalid-position");
    for (let position = 0; position < 10; position += 1) {
      assert.strictEqual(service.setPosition(guestAuth.session, "guest", position).ok, true);
      assert.strictEqual(guestAuth.session.position, position);
    }

    const hostResponse = fakeResponse();
    const guestResponse = fakeResponse();
    service.openStream(hostAuth.session, "host", hostResponse);
    service.openStream(guestAuth.session, "guest", guestResponse);
    guestResponse.emit("close");
    clock += 50;
    service.sweep();
    assert.strictEqual(service.authorize(host.code, guest.capability).ok, false, "Expired guest grace must revoke the guest.");
    assert.strictEqual(service.authorize(host.code, host.capability).ok, true);
    assert.strictEqual(hostAuth.session.status, "waiting");
    hostResponse.emit("close");
    clock += 51;
    service.sweep();
    assert.strictEqual(service.authorize(host.code, host.capability).ok, false, "Expired host grace must end the session.");

    const idle = service.create();
    clock += 101;
    service.sweep();
    assert.strictEqual(service.authorize(idle.code, idle.capability).ok, false, "Idle sessions must expire.");

    service.close();

    const ageService = createSessionService({
      now: () => clock,
      idleTimeoutMs: 5_000,
      maximumAgeMs: 1_000,
      sweepIntervalMs: 60_000
    });
    const aged = ageService.create();
    clock += 900;
    assert.strictEqual(ageService.authorize(aged.code, aged.capability).ok, true);
    clock += 101;
    ageService.sweep();
    assert.strictEqual(ageService.authorize(aged.code, aged.capability).ok, false, "Maximum session age must be enforced even with activity.");
    assert.strictEqual(ageService.size, 0);
    ageService.close();
  } finally {
    service.close();
  }
}

async function run() {
  await testApprovalAuthorizationAndSynchronizedSlider();
  await testJoinRejectionAndConcurrentCapacity();
  await testValidationRateLimitsAndExistingRouteIsolation();
  testLifecycleLeasesAndCleanup();
  console.log("Massagefeedback server tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
