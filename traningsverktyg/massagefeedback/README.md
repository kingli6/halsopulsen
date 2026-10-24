# Massagefeedback session API

The server-only session API is mounted at `/api/massagefeedback`. It keeps
session state in the current Express process and uses SSE for authorized live
updates. No participant names, massage history, or persistent session data are
stored.

## Authentication and joining

- `POST /sessions` creates a six-character code and returns a separate
  256-bit host capability. The code is only a lookup key, never authorization.
- `POST /join-requests` accepts a code and reserves the single guest slot while
  the host decides. A temporary join ticket is returned to the requesting
  device; it is not a slider/session capability.
- `POST /sessions/:code/join-requests/:requestId/decision` requires the host
  capability. The guest capability is generated only after approval and is
  delivered to the guest through the ticket-authenticated status endpoint.
- Protected requests, including SSE, use `Authorization: Bearer <capability>`.
  Capabilities and join tickets are not put in URLs or logged.
- `/sessions/:code/events` authenticates before returning an event stream.
  Reconnecting with the same capability replaces the previous stream and
  receives a fresh authoritative state snapshot.

## Slider updates and limits

The shared API mutation limiter would throttle ordinary pointer movement, so
only `POST /sessions/:code/position` is exempted from the existing global API
and mutation counters. That endpoint has a dedicated limit of 30 requests per
second per client IP. All position writes still require a capability, an
active server-side lease, and an integer position from 0 to 9. Creation, code
attempts, polling, SSE connections, and other actions have separate limits in
addition to the existing general API limits. A future client should coalesce
pointer events rather than send more often than the position limit.

The server grants one drag lease at a time. Position writes renew it; release,
stream disconnect, and lease expiry relinquish it. A lost release therefore
cannot lock the slider indefinitely.

## Lifecycle and deployment boundary

Heartbeat activity, reconnect grace, idle expiry, maximum session age, pending
join expiry, stream close handling, and lease expiry are maintained in memory.
The current defaults are a 30-second reconnect grace, five-minute idle expiry,
one-hour maximum age, and three-second lease.

This service requires one shared Express process. Its in-memory state is lost
on restart and is not shared across multiple app instances. Do not scale this
API horizontally or claim sessions survive restarts until a shared
transactional store and cross-instance event delivery are added.
