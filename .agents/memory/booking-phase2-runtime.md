---
name: Booking Phase 2 runtime constraints
description: PostgreSQL driver and migration-runner constraints relevant to the booking backend.
---

Production PostgreSQL DATE columns may arrive through `pg` as JavaScript `Date` objects, while local API inputs are ISO date strings. Normalize database dates before comparing them.

**Why:** Direct string comparisons caused date overrides to be silently skipped in production availability calculations.

**How to apply:** Normalize all database DATE values at the service boundary, and execute queries sequentially when using one pinned `pg` transaction client; concurrent queries on that client are unsupported.