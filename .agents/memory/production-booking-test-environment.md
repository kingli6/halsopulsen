---
name: Production booking test environment
description: The environment boundary affecting direct production booking test runs.
---

The direct shell test process may not receive `SUPABASE_DATABASE_URL` even when the workspace secret inventory reports the secret exists in each environment.

**Why:** The production-backed booking test can fail before opening a database connection, so that failure does not prove a schema or application regression.

**How to apply:** Distinguish secret injection/configuration failures from test assertions, and do not run migration commands merely to make the test start.