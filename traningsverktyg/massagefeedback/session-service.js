const crypto = require("crypto");
const { CHOICES, isValidPosition } = require("./session-model");

const POSITIONS = Object.freeze(CHOICES.map(choice => choice.value));
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULTS = Object.freeze({
  codeLength: 6,
  maxSessions: 500,
  idleTimeoutMs: 5 * 60 * 1000,
  maximumAgeMs: 60 * 60 * 1000,
  reconnectGraceMs: 30 * 1000,
  joinRequestTimeoutMs: 60 * 1000,
  dragLeaseMs: 3 * 1000,
  sweepIntervalMs: 250,
  streamHeartbeatMs: 15 * 1000
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function matchesHash(value, expectedHash) {
  if (typeof value !== "string" || !expectedHash) return false;
  const actualHash = sha256(value);
  return actualHash.length === expectedHash.length
    && crypto.timingSafeEqual(actualHash, expectedHash);
}

function createSessionService(options = {}) {
  const settings = { ...DEFAULTS, ...options };
  if (!Number.isSafeInteger(settings.maxSessions) || settings.maxSessions < 1) {
    throw new TypeError("maxSessions must be a positive safe integer.");
  }
  const now = options.now || Date.now;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const randomInt = options.randomInt || crypto.randomInt;
  const sessions = new Map();

  function createCode() {
    let code = "";
    for (let index = 0; index < settings.codeLength; index += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return code;
  }

  function createCapability() {
    return randomBytes(32).toString("base64url");
  }

  function getSession(code) {
    if (typeof code !== "string") return null;
    const session = sessions.get(code.trim().toUpperCase()) || null;
    if (!session) return null;
    const timestamp = now();
    if (
      timestamp - session.createdAt >= settings.maximumAgeMs
      || timestamp - session.lastActivityAt >= settings.idleTimeoutMs
    ) {
      endSession(session);
      return null;
    }
    expireLease(session, timestamp);
    for (const role of ["guest", "host"]) {
      if (expireDisconnectedParticipant(session, role, timestamp) && role === "host") return null;
    }
    return sessions.get(session.code) === session ? session : null;
  }

  function participantFor(session, role) {
    return role === "host" ? session.participants.host : session.participants.guest;
  }

  function publicState(session, role = null) {
    return {
      code: session.code,
      status: session.status,
      position: session.position,
      participants: ["host", "guest"].flatMap(participantRole => {
        const participant = participantFor(session, participantRole);
        return participant ? [{
          role: participantRole,
          connected: participant.connected
        }] : [];
      }),
      activeControl: session.lease?.participant || null,
      pendingJoin: role === "host" && session.pendingJoinRequestId
        ? { requestId: session.pendingJoinRequestId }
        : null
    };
  }

  function writeEvent(stream, eventName, data) {
    if (stream.closed || stream.response.destroyed || stream.response.writableEnded) return false;
    if (stream.backpressured) {
      stream.pendingEvent = eventName === "session-ended"
        ? { eventName, data }
        : { eventName: "state", data: publicState(stream.session, stream.role) };
      return true;
    }
    try {
      const writable = stream.response.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      if (writable === false) stream.backpressured = true;
      return true;
    } catch {
      return false;
    }
  }

  function broadcast(session, eventName = "state", excludeStream = null) {
    for (const [role, stream] of session.streams) {
      if (stream === excludeStream) continue;
      const payload = eventName === "session-ended"
        ? { status: "ended" }
        : publicState(session, role);
      if (!writeEvent(stream, eventName, payload)) closeStream(session, role, stream);
    }
  }

  function closeStream(session, role, stream, endResponse = true) {
    if (!stream || stream.closed) return;
    stream.closed = true;
    clearInterval(stream.heartbeatTimer);
    stream.pendingEvent = null;
    stream.response.removeListener?.("drain", stream.onDrain);
    stream.response.removeListener?.("close", stream.onClose);
    stream.response.removeListener?.("error", stream.onError);
    if (session.streams.get(role) === stream) {
      session.streams.delete(role);
      const participant = participantFor(session, role);
      if (participant) {
        participant.connected = false;
        participant.disconnectedAt = now();
      }
      if (role === "host" || session.lease?.participant === role) session.lease = null;
    }
    if (endResponse && !stream.response.writableEnded) {
      try { stream.response.end(); } catch {}
    }
    if (sessions.get(session.code) === session && session.status !== "ended") broadcast(session);
  }

  function endSession(session) {
    if (!session || session.status === "ended") return false;
    session.status = "ended";
    session.participants.host = null;
    session.participants.guest = null;
    session.lease = null;
    session.pendingJoinRequestId = null;
    broadcast(session, "session-ended");
    for (const [role, stream] of [...session.streams]) {
      closeStream(session, role, stream);
    }
    session.joinRequests.clear();
    if (sessions.get(session.code) === session) sessions.delete(session.code);
    return true;
  }

  function expireDisconnectedParticipant(session, role, timestamp = now()) {
    const participant = participantFor(session, role);
    if (!participant?.disconnectedAt || timestamp - participant.disconnectedAt < settings.reconnectGraceMs) {
      return false;
    }
    if (role === "host") {
      endSession(session);
      return true;
    }
    session.participants.guest = null;
    session.status = "waiting";
    session.lease = session.lease?.participant === "guest" ? null : session.lease;
    session.joinRequests.clear();
    session.pendingJoinRequestId = null;
    session.lastActivityAt = timestamp;
    broadcast(session);
    return true;
  }

  function expireLease(session, timestamp = now()) {
    if (session.lease && session.lease.expiresAt <= timestamp) {
      session.lease = null;
      broadcast(session);
    }
  }

  function create() {
    sweep();
    if (sessions.size >= settings.maxSessions) {
      return { ok: false, reason: "capacity" };
    }
    let code = "";
    for (let attempt = 0; attempt < 32; attempt += 1) {
      code = createCode();
      if (!sessions.has(code)) break;
      code = "";
    }
    if (!code) throw new Error("Could not allocate a unique Massagefeedback session code.");

    const timestamp = now();
    const capability = createCapability();
    const session = {
      code,
      createdAt: timestamp,
      lastActivityAt: timestamp,
      status: "waiting",
      position: 0,
      participants: {
        host: {
          capabilityHash: sha256(capability),
          connected: false,
          disconnectedAt: null
        },
        guest: null
      },
      pendingJoinRequestId: null,
      joinRequests: new Map(),
      lease: null,
      streams: new Map()
    };
    sessions.set(code, session);
    return { ok: true, code, capability, state: publicState(session, "host") };
  }

  function requestJoin(code) {
    const session = getSession(code);
    const timestamp = now();
    if (
      !session
      || session.status === "ended"
      || session.participants.guest
      || session.pendingJoinRequestId
    ) {
      return { ok: false, reason: "unavailable" };
    }

    const requestId = randomBytes(16).toString("base64url");
    const joinTicket = createCapability();
    session.pendingJoinRequestId = requestId;
    session.joinRequests.set(requestId, {
      requestId,
      joinTicketHash: sha256(joinTicket),
      status: "pending",
      createdAt: timestamp,
      guestCapability: null
    });
    session.lastActivityAt = timestamp;
    broadcast(session, "join-request");
    return { ok: true, requestId, joinTicket, status: "pending" };
  }

  function getJoinStatus(code, requestId, joinTicket) {
    const session = getSession(code);
    const request = session?.joinRequests.get(requestId);
    if (!request || !matchesHash(joinTicket, request.joinTicketHash)) {
      return { ok: false, reason: "unavailable" };
    }
    if (request.status === "pending" && now() - request.createdAt >= settings.joinRequestTimeoutMs) {
      request.status = "expired";
      if (session.pendingJoinRequestId === requestId) session.pendingJoinRequestId = null;
      broadcast(session);
    }
    session.lastActivityAt = now();
    return {
      ok: true,
      status: request.status,
      capability: request.status === "approved" ? request.guestCapability : null
    };
  }

  function decideJoin(code, requestId, decision) {
    const session = getSession(code);
    const request = session?.joinRequests.get(requestId);
    if (
      !session
      || !request
      || request.status !== "pending"
      || session.pendingJoinRequestId !== requestId
    ) {
      return { ok: false, reason: "unavailable" };
    }
    if (now() - request.createdAt >= settings.joinRequestTimeoutMs) {
      request.status = "expired";
      session.pendingJoinRequestId = null;
      broadcast(session);
      return { ok: false, reason: "expired" };
    }

    if (decision === "reject") {
      request.status = "rejected";
      session.pendingJoinRequestId = null;
      session.lastActivityAt = now();
      broadcast(session);
      return { ok: true, status: "rejected" };
    }

    if (decision !== "approve" || session.participants.guest) {
      return { ok: false, reason: "unavailable" };
    }
    const capability = createCapability();
    session.participants.guest = {
      capabilityHash: sha256(capability),
      connected: false,
      disconnectedAt: null
    };
    session.status = "connected";
    request.status = "approved";
    request.guestCapability = capability;
    session.pendingJoinRequestId = null;
    session.lastActivityAt = now();
    broadcast(session);
    return { ok: true, status: "approved" };
  }

  function authorize(code, capability) {
    const session = getSession(code);
    if (!session || session.status === "ended" || typeof capability !== "string") {
      return { ok: false, reason: "unauthorized" };
    }
    const role = ["host", "guest"].find(participantRole => {
      const participant = participantFor(session, participantRole);
      return participant && matchesHash(capability, participant.capabilityHash);
    });
    if (!role) return { ok: false, reason: "unauthorized" };

    session.lastActivityAt = now();
    const guestRequest = role === "guest"
      ? [...session.joinRequests.values()].find(request =>
        request.status === "approved"
        && request.guestCapability
        && matchesHash(capability, session.participants.guest.capabilityHash))
      : null;
    if (guestRequest) guestRequest.guestCapability = null;
    expireLease(session);
    return { ok: true, role, session, state: publicState(session, role) };
  }

  function claimControl(session, role) {
    expireLease(session);
    if (role === "guest" && !session.participants.host?.connected) {
      return { ok: false, reason: "host-disconnected", state: publicState(session, role) };
    }
    if (session.lease && session.lease.participant !== role) {
      return { ok: false, reason: "locked", state: publicState(session, role) };
    }
    session.lease = { participant: role, expiresAt: now() + settings.dragLeaseMs };
    session.lastActivityAt = now();
    broadcast(session);
    return { ok: true, state: publicState(session, role) };
  }

  function setPosition(session, role, position) {
    expireLease(session);
    if (!isValidPosition(position)) {
      return { ok: false, reason: "invalid-position" };
    }
    if (role === "guest" && !session.participants.host?.connected) {
      return { ok: false, reason: "host-disconnected" };
    }
    if (!session.lease || session.lease.participant !== role) {
      return { ok: false, reason: session.lease ? "locked" : "lease-required" };
    }
    session.position = position;
    session.lease.expiresAt = now() + settings.dragLeaseMs;
    session.lastActivityAt = now();
    broadcast(session);
    return { ok: true, state: publicState(session, role) };
  }

  function releaseControl(session, role) {
    expireLease(session);
    if (session.lease?.participant === role) {
      session.lease = null;
      session.lastActivityAt = now();
      broadcast(session);
    }
    return { ok: true, state: publicState(session, role) };
  }

  function heartbeat(session, role) {
    const participant = participantFor(session, role);
    if (!participant) return { ok: false, reason: "unauthorized" };
    session.lastActivityAt = now();
    return { ok: true, state: publicState(session, role) };
  }

  function leave(session, role) {
    if (role === "host") {
      endSession(session);
      return { ok: true, ended: true };
    }
    if (!session.participants.guest) return { ok: false, reason: "unauthorized" };
    session.participants.guest = null;
    session.status = "waiting";
    session.lease = session.lease?.participant === "guest" ? null : session.lease;
    session.joinRequests.clear();
    session.pendingJoinRequestId = null;
    session.lastActivityAt = now();
    broadcast(session);
    return { ok: true, ended: false, state: publicState(session, role) };
  }

  function end(session) {
    return endSession(session);
  }

  function openStream(session, role, response) {
    const existing = session.streams.get(role);
    if (existing) closeStream(session, role, existing);

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");

    const stream = {
      session,
      role,
      response,
      closed: false,
      backpressured: false,
      pendingEvent: null,
      heartbeatTimer: setInterval(() => {
        if (!writeEventComment(stream)) closeStream(session, role, stream);
      }, settings.streamHeartbeatMs)
    };
    stream.heartbeatTimer.unref?.();
    stream.onDrain = () => {
      if (stream.closed) return;
      stream.backpressured = false;
      const pendingEvent = stream.pendingEvent;
      stream.pendingEvent = null;
      if (pendingEvent && !writeEvent(stream, pendingEvent.eventName, pendingEvent.data)) {
        closeStream(session, role, stream);
      }
    };
    stream.onClose = () => closeStream(session, role, stream, false);
    stream.onError = () => closeStream(session, role, stream, false);
    response.on("drain", stream.onDrain);
    response.on("close", stream.onClose);
    response.on("error", stream.onError);
    session.streams.set(role, stream);
    const participant = participantFor(session, role);
    participant.connected = true;
    participant.disconnectedAt = null;
    try {
      response.flushHeaders?.();
    } catch {
      closeStream(session, role, stream);
      return { ok: false };
    }
    if (!writeRaw(stream, "retry: 2000\n\n")) {
      closeStream(session, role, stream);
      return { ok: false };
    }
    if (!writeEvent(stream, "state", publicState(session, role))) {
      closeStream(session, role, stream);
      return { ok: false };
    }
    response.flush?.();
    broadcast(session, "state", stream);
    return { ok: true };
  }

  function writeRaw(stream, chunk) {
    if (stream.closed || stream.response.destroyed || stream.response.writableEnded) return false;
    if (stream.backpressured) return true;
    try {
      if (stream.response.write(chunk) === false) stream.backpressured = true;
      return true;
    } catch {
      return false;
    }
  }

  function writeEventComment(stream) {
    if (stream.closed || stream.response.destroyed || stream.response.writableEnded) return false;
    if (stream.backpressured) return true;
    try {
      if (stream.response.write(": keep-alive\n\n") === false) stream.backpressured = true;
      return true;
    } catch {
      return false;
    }
  }

  function sweep() {
    const timestamp = now();
    for (const session of [...sessions.values()]) {
      if (
        timestamp - session.createdAt >= settings.maximumAgeMs
        || timestamp - session.lastActivityAt >= settings.idleTimeoutMs
      ) {
        endSession(session);
        continue;
      }

      expireLease(session, timestamp);
      for (const [requestId, request] of session.joinRequests) {
        if (request.status === "pending" && timestamp - request.createdAt >= settings.joinRequestTimeoutMs) {
          request.status = "expired";
          if (session.pendingJoinRequestId === requestId) session.pendingJoinRequestId = null;
          broadcast(session);
        }
        if (request.status !== "pending" && timestamp - request.createdAt >= settings.joinRequestTimeoutMs * 2) {
          session.joinRequests.delete(requestId);
        }
      }

      for (const role of ["guest", "host"]) {
        expireDisconnectedParticipant(session, role, timestamp);
        if (!sessions.has(session.code)) break;
      }
    }
  }

  const cleanupTimer = setInterval(sweep, settings.sweepIntervalMs);
  cleanupTimer.unref?.();

  return {
    positions: POSITIONS,
    create,
    requestJoin,
    getJoinStatus,
    decideJoin,
    authorize,
    claimControl,
    setPosition,
    releaseControl,
    heartbeat,
    leave,
    end,
    openStream,
    sweep,
    close() {
      clearInterval(cleanupTimer);
      for (const session of [...sessions.values()]) endSession(session);
      sessions.clear();
    },
    get size() {
      return sessions.size;
    }
  };
}

module.exports = { createSessionService, POSITIONS };
