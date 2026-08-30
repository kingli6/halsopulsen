---
name: Booking migration portability
description: Portability and history rules for the separate development and Supabase booking migrations.
---

Booking schema migrations must handle equivalent constraints whose names differ between development PostgreSQL and the Supabase foundation. Drop legacy exclusion constraints before nulling range bounds, because PostgreSQL treats `tstzrange(NULL, NULL)` as unbounded. Once a filename has been recorded as applied, use a new corrective migration rather than editing its historical behavior in place.

**Why:** The local foundation used a generated status-check name while the production foundation used an explicit name, and the migration runner tracks filenames.

**How to apply:** Make additive booking migrations idempotent across both environments, keep production migration files separate from development-only migrations, and use a numbered follow-up migration for repairs to already-applied development state.