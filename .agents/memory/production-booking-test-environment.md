---
name: Production booking test environment
description: The environment boundary affecting direct production booking test runs.
---

The direct shell test process may not receive `SUPABASE_DATABASE_URL` even when the workspace secret inventory reports the secret exists in each environment. `DATABASE_URL` can independently point to Replit development PostgreSQL, so a successful test against it does not validate Supabase credentials.

**Why:** The production-backed booking test can fail before opening a database connection, so that failure does not prove a schema or application regression.

**How to apply:** Distinguish secret injection/configuration failures from test assertions, compare redacted parsed host/project-ref fields before changing code, and keep Supabase migration checks explicitly bound to `SUPABASE_DATABASE_URL`.