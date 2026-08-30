---
name: Supabase production booking boundary
description: Production booking schema and connection are intentionally separate from Replit development PostgreSQL.
---

The booking production database is the existing Supabase PostgreSQL project.
Replit PostgreSQL remains the development/test database for unrelated application
data and must not be used as a silent production fallback.

**Why:** The live frontend is static and the project has separate Replit and
Supabase database environments; conflating them makes a successful local
migration look like a production migration.

**How to apply:** Keep production booking migrations and connection selection
explicitly Supabase-targeted, verify the actual Supabase database after every
migration, and preserve the application's general Replit `DATABASE_URL` path.