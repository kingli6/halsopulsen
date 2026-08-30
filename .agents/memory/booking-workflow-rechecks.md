---
name: Booking workflow rechecks
description: Rules for rechecking availability during appointment approval and alternative acceptance.
---

Availability rechecks must exclude the appointment currently being approved or accepted from the blocking query.

**Why:** An alternative offer intentionally reserves its proposed interval, so accepting it would otherwise see the appointment's own proposal as a conflict.

**How to apply:** Pass an explicit appointment identifier only for workflow rechecks; public availability must continue to include all confirmed and alternative-suggested reservations.