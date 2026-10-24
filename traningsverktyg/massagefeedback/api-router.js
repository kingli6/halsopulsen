const express = require("express");
const { createSessionService } = require("./session-service");

const MASSAGEFEEDBACK_ALLOWED_ORIGIN = "https://halsopulsen.se";
const MASSAGEFEEDBACK_CORS_METHODS = Object.freeze(["GET", "POST", "OPTIONS"]);
const MASSAGEFEEDBACK_CORS_HEADERS = Object.freeze([
  "authorization",
  "content-type",
  "x-massage-join-ticket"
]);

const DEFAULT_LIMITS = Object.freeze({
  create: { windowMs: 10 * 60 * 1000, max: 5 },
  join: { windowMs: 10 * 60 * 1000, max: 12 },
  joinStatus: { windowMs: 60 * 1000, max: 30 },
  action: { windowMs: 60 * 1000, max: 60 },
  heartbeat: { windowMs: 60 * 1000, max: 60 },
  position: { windowMs: 1000, max: 30 },
  events: { windowMs: 60 * 1000, max: 10 }
});
const MAX_RATE_BUCKETS = 10_000;

function createMassageFeedbackCorsMiddleware() {
  return (req, res, next) => {
    const origin = req.get("origin");
    const isAllowedOrigin = origin === MASSAGEFEEDBACK_ALLOWED_ORIGIN;

    if (origin) res.vary("Origin");
    if (isAllowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", MASSAGEFEEDBACK_ALLOWED_ORIGIN);
      res.setHeader("Access-Control-Expose-Headers", "Retry-After");
    }

    if (req.method !== "OPTIONS" || !req.get("access-control-request-method")) {
      return next();
    }

    res.vary("Access-Control-Request-Method");
    res.vary("Access-Control-Request-Headers");

    const requestedMethod = req.get("access-control-request-method").toUpperCase();
    const requestedHeaders = String(req.get("access-control-request-headers") || "")
      .split(",")
      .map(header => header.trim().toLowerCase())
      .filter(Boolean);
    if (
      !isAllowedOrigin
      || !MASSAGEFEEDBACK_CORS_METHODS.includes(requestedMethod)
      || requestedHeaders.some(header => !MASSAGEFEEDBACK_CORS_HEADERS.includes(header))
    ) {
      return res.sendStatus(403);
    }

    res.setHeader("Access-Control-Allow-Methods", MASSAGEFEEDBACK_CORS_METHODS.join(", "));
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Massage-Join-Ticket"
    );
    return res.status(204).end();
  };
}

function requestAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function makeRateLimiter({ windowMs, max }, key = requestAddress) {
  const buckets = new Map();
  return (req, res, next) => {
    const timestamp = Date.now();
    const bucketKey = String(key(req));
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= timestamp) {
      bucket = { count: 0, resetAt: timestamp + windowMs };
    }
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
    if (buckets.size > MAX_RATE_BUCKETS) {
      for (const [storedKey, storedBucket] of buckets) {
        if (storedBucket.resetAt <= timestamp) buckets.delete(storedKey);
        if (buckets.size <= MAX_RATE_BUCKETS) break;
      }
      if (buckets.size > MAX_RATE_BUCKETS) buckets.delete(buckets.keys().next().value);
    }
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000))));
      return res.status(429).json({
        ok: false,
        error: "Too many requests. Please wait and try again."
      });
    }
    next();
  };
}

function hasOnlyKeys(body, allowedKeys) {
  return body
    && typeof body === "object"
    && !Array.isArray(body)
    && Object.keys(body).every(key => allowedKeys.includes(key));
}

function capabilityFromRequest(req) {
  const authorization = String(req.get("authorization") || "");
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,64})$/);
  return match ? match[1] : null;
}

function isHighFrequencyPositionRequest(req) {
  const requestPath = String(req.originalUrl || req.url || "").split("?")[0];
  return req.method === "POST"
    && /^\/api\/massagefeedback\/sessions\/[^/]+\/position\/?$/.test(requestPath);
}

function sessionOptionsFromEnvironment(options) {
  const sessionOptions = { ...(options.sessionOptions || {}) };
  if (
    sessionOptions.maxSessions === undefined
    && process.env.MASSAGEFEEDBACK_MAX_SESSIONS !== undefined
  ) {
    sessionOptions.maxSessions = Number(process.env.MASSAGEFEEDBACK_MAX_SESSIONS);
  }
  return sessionOptions;
}

function createMassageFeedbackRouter(options = {}) {
  const router = express.Router();
  const service = options.service || createSessionService(sessionOptionsFromEnvironment(options));
  const limits = { ...DEFAULT_LIMITS, ...(options.rateLimits || {}) };
  const limiters = {
    create: makeRateLimiter(limits.create, options.addressKey || requestAddress),
    join: makeRateLimiter(limits.join, options.addressKey || requestAddress),
    joinStatus: makeRateLimiter(limits.joinStatus, options.addressKey || requestAddress),
    action: makeRateLimiter(limits.action, options.addressKey || requestAddress),
    heartbeat: makeRateLimiter(limits.heartbeat, options.addressKey || requestAddress),
    position: makeRateLimiter(limits.position, options.addressKey || requestAddress),
    events: makeRateLimiter(limits.events, options.addressKey || requestAddress)
  };

  function requireCapability(req, res) {
    const capability = capabilityFromRequest(req);
    const authorized = service.authorize(req.params.code, capability);
    if (!authorized.ok) {
      res.status(401).json({ ok: false, error: "Session access is invalid or expired." });
      return null;
    }
    req.massageFeedbackAuthorization = authorized;
    return authorized;
  }

  router.post("/sessions", limiters.create, (req, res) => {
    if (!hasOnlyKeys(req.body, [])) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const created = service.create();
    if (!created.ok) {
      res.setHeader("Retry-After", "60");
      return res.status(503).json({
        ok: false,
        error: "The service is temporarily at capacity. Please try again later."
      });
    }
    res.status(201).json({
      ok: true,
      code: created.code,
      capability: created.capability,
      participant: "host",
      state: created.state
    });
  });

  router.post("/join-requests", limiters.join, (req, res) => {
    if (!hasOnlyKeys(req.body, ["code"]) || typeof req.body.code !== "string" || req.body.code.length > 8) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const result = service.requestJoin(req.body.code);
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: "This session cannot accept a join request." });
    }
    return res.status(202).json({
      ok: true,
      requestId: result.requestId,
      joinTicket: result.joinTicket,
      status: result.status
    });
  });

  router.post("/join-requests/status", limiters.joinStatus, (req, res) => {
    if (
      !hasOnlyKeys(req.body, ["code", "requestId"])
      || typeof req.body.code !== "string"
      || typeof req.body.requestId !== "string"
      || req.body.requestId.length > 64
    ) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const result = service.getJoinStatus(
      req.body.code,
      req.body.requestId,
      req.get("x-massage-join-ticket")
    );
    if (!result.ok) return res.status(404).json({ ok: false, error: "Join request is unavailable." });
    return res.json({
      ok: true,
      status: result.status,
      ...(result.capability ? { capability: result.capability } : {})
    });
  });

  router.post("/sessions/:code/join-requests/:requestId/decision", limiters.action, (req, res) => {
    if (!hasOnlyKeys(req.body, ["decision"]) || !["approve", "reject"].includes(req.body.decision)) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    if (authorized.role !== "host") {
      return res.status(403).json({ ok: false, error: "Only the host can decide join requests." });
    }
    const result = service.decideJoin(req.params.code, req.params.requestId, req.body.decision);
    if (!result.ok) return res.status(409).json({ ok: false, error: "Join request is no longer available." });
    return res.json({ ok: true, status: result.status });
  });

  router.get("/sessions/:code", limiters.action, (req, res) => {
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    return res.json({ ok: true, state: authorized.state });
  });

  router.get("/sessions/:code/events", limiters.events, (req, res) => {
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    service.openStream(authorized.session, authorized.role, res);
  });

  router.post("/sessions/:code/heartbeat", limiters.heartbeat, (req, res) => {
    if (!hasOnlyKeys(req.body, [])) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    return res.json(service.heartbeat(authorized.session, authorized.role));
  });

  router.post("/sessions/:code/control/claim", limiters.action, (req, res) => {
    if (!hasOnlyKeys(req.body, [])) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    const result = service.claimControl(authorized.session, authorized.role);
    if (result.reason === "host-disconnected") {
      return res.status(409).json({ ok: false, error: "The host is reconnecting. Slider control is paused." });
    }
    if (!result.ok) return res.status(409).json({ ok: false, error: "The other participant is adjusting feedback." });
    return res.json({ ok: true, state: result.state });
  });

  router.post("/sessions/:code/position", limiters.position, (req, res) => {
    if (!hasOnlyKeys(req.body, ["position"]) || !Number.isInteger(req.body.position)) {
      return res.status(400).json({ ok: false, error: "Position must be an integer from 0 to 9." });
    }
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    const result = service.setPosition(authorized.session, authorized.role, req.body.position);
    if (!result.ok) {
      const status = result.reason === "invalid-position" ? 400 : 409;
      const error = result.reason === "invalid-position"
        ? "Position must be an integer from 0 to 9."
        : result.reason === "host-disconnected"
          ? "The host is reconnecting. Slider control is paused."
        : result.reason === "locked"
          ? "The other participant is adjusting feedback."
          : "Claim slider control before changing the position.";
      return res.status(status).json({ ok: false, error });
    }
    return res.json({ ok: true, state: result.state });
  });

  router.post("/sessions/:code/control/release", limiters.action, (req, res) => {
    if (!hasOnlyKeys(req.body, [])) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    return res.json(service.releaseControl(authorized.session, authorized.role));
  });

  router.post("/sessions/:code/leave", limiters.action, (req, res) => {
    if (!hasOnlyKeys(req.body, [])) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    return res.json(service.leave(authorized.session, authorized.role));
  });

  router.post("/sessions/:code/end", limiters.action, (req, res) => {
    if (!hasOnlyKeys(req.body, [])) {
      return res.status(400).json({ ok: false, error: "The request body is invalid." });
    }
    const authorized = requireCapability(req, res);
    if (!authorized) return;
    service.end(authorized.session);
    return res.json({ ok: true, status: "ended" });
  });

  router.close = () => service.close();
  router.sessionService = service;
  return router;
}

module.exports = {
  createMassageFeedbackCorsMiddleware,
  createMassageFeedbackRouter,
  isHighFrequencyPositionRequest
};
