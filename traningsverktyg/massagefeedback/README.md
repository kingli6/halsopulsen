# Massagefeedback session API

The server-only session API is mounted at `/api/massagefeedback`. It keeps
session state in the current Express process and uses SSE for authorized live
updates. No participant names, massage history, or persistent session data are
stored.

## Browser session flow

The browser page maps the host to phone 1 and the guest to phone 2. The host
creates a session; the guest requests access with the six-character code; the
host must approve the request before the guest receives a session capability.
The browser renders the server's position and drag owner rather than deciding
either value locally.

The page keeps capabilities and the temporary join ticket only in JavaScript
memory. It sends them in authorization or join-ticket headers, never in a URL,
browser storage, or the visible interface. Refreshing the page clears those
credentials; the participant must start or join again. The QR image is
generated locally and contains only the public session code.

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
  receives a fresh authoritative state snapshot. Participant `connected`
  status reflects an open event stream; ordinary HTTP requests and heartbeats
  refresh activity but do not reconnect a closed stream.

## Slider updates and limits

The shared API mutation limiter would throttle ordinary pointer movement, so
only `POST /sessions/:code/position` is exempted from the existing global API
and mutation counters. That endpoint has a dedicated limit of 30 requests per
second per client IP. All position writes still require a capability, an
active server-side lease, and an integer position from 0 to 9. Creation, code
attempts, polling, SSE connections, and other actions have separate limits in
addition to the existing general API limits. A future client should coalesce
pointer events rather than send more often than the position limit.

Heartbeats are limited to 60 requests per minute per client IP. This allows two
devices on the same network to heartbeat every five seconds (24 combined
requests per minute) while retaining a per-IP abuse limit.

The server grants one drag lease at a time. Position writes renew it; release,
stream disconnect, and lease expiry relinquish it. A lost release therefore
cannot lock the slider indefinitely.

SSE streams respect Node's write backpressure. While a response is backpressured,
the server keeps at most one deferred state update and replaces it with the
latest state as changes arrive. A `drain` resumes delivery; `close` and `error`
remove the stream and its listeners.

## Lifecycle and deployment boundary

Heartbeat activity, reconnect grace, idle expiry, maximum session age, pending
join expiry, stream close handling, and lease expiry are maintained in memory.
The current defaults are a 30-second reconnect grace, five-minute idle expiry,
one-hour maximum age, and three-second lease.

If the host loses its event stream, the guest remains connected during the
30-second reconnect grace, but cannot claim slider control or change the
position. A host reconnect during that period restores normal control. If the
host does not reconnect before grace expires, the whole session ends and both
capabilities become invalid. A guest that stays disconnected beyond the grace
period is removed while the host session returns to the waiting state.

The process allows up to 500 active sessions by default, including sessions
with pending join requests. Set `MASSAGEFEEDBACK_MAX_SESSIONS` to a positive
integer to change the limit. At capacity, creation returns HTTP 503 with a
`Retry-After` header; ended and expired sessions release their capacity.

This service requires one shared Express process. Its in-memory state is lost
on restart and is not shared across multiple app instances. Do not scale this
API horizontally or claim sessions survive restarts until a shared
transactional store and cross-instance event delivery are added.
