# Resource and storage policy

This project separates public website assets from private, changing coaching
data. The goal is to keep the application inexpensive and easy to monitor
without silently deleting useful history.

## What belongs where

### GitHub repository and GitHub Pages

Use GitHub for small, public, versioned assets that ship with the website:

- HTML, CSS, JavaScript, and icons
- Logos and public exercise illustrations
- Optimized WebP, AVIF, or SVG assets

Do not put these in the repository:

- Participant data
- Private photos or uploaded files
- Supabase credentials or session secrets
- Generated exports, backups, videos, or large originals
- Runtime drafts or logs

GitHub's current limits include a recommended repository size below 1 GB,
published GitHub Pages sites below 1 GB, a soft Pages bandwidth limit of
100 GB/month, and a soft limit of 10 Pages builds/hour. GitHub blocks regular
repository files larger than 100 MiB; files above 50 MiB receive a warning.
This project uses a stricter local warning threshold so assets stay easy to
maintain.

### Supabase Postgres

Use Postgres for structured, private, changing data:

- Owner identity and access rules
- Plan metadata and published versions
- Workouts, activities, prescriptions, assignments, and logs
- Reusable activity, individual-workout, and week templates
- Asset metadata and references, but not image bytes

Prefer relational rows for logs and frequently updated records. A JSONB
snapshot is appropriate for an immutable published version or reusable
template, but the app must not rewrite a full plan snapshot for every small
field edit or participant log.

### Supabase Storage or another object store

Use object storage only for private or user-uploaded files that cannot be
public website assets. Store only the object path, ownership, content type,
and size in Postgres. Never store base64-encoded images in a database row.

## Cleanup rules

Cleanup must be reference-aware and auditable:

1. Every stored file has an owner and a purpose.
2. Every object has a database reference before it is considered active.
3. Temporary uploads use a separate prefix and an expiry time.
4. A cleanup job may delete only expired temporary files or confirmed orphans.
5. User plans, logs, templates, and published history are never deleted by a
   generic storage cleanup job.
6. Run a dry-run report before the first destructive cleanup.
7. Keep a cleanup audit record with the object path, reason, and timestamp.

For the current prototype, the local `audit:footprint` command is intentionally
read-only. Automatic Supabase cleanup should be added only after the Supabase
schema and retention period have been agreed.

## Monitoring checklist

### Supabase

Open the Supabase dashboard and check:

1. **Organization → Usage** (`https://supabase.com/dashboard/org/_/usage`)
   - Database size
   - Storage size
   - Egress/bandwidth
   - Monthly active users
   - Edge Function invocations
   - Realtime messages/connections, if Realtime is enabled
2. **Project → Reports/Observability → Database**
   - Actual Postgres database size and growth
3. **Project → Storage → Buckets**
   - Bucket sizes and unexpected objects
4. **Project → Logs → Logs Explorer**
   - Repeated downloads, failed requests, and storage egress
5. **Project → Authentication → Users**
   - Unexpected account growth

Current free-plan reference points from Supabase documentation:

- Postgres database read-only threshold: 500 MB
- New project baseline: approximately 40–60 MB
- Storage quota: 1 GB
- Bandwidth/egress: 10 GB total, split into cached and uncached allowances
- Monthly active users: 50,000
- Edge Function invocations: 500,000

Use these internal guardrails:

- Warning: 60% of a quota
- Critical: 80% of a quota
- Stop adding optional data or investigate: 90% of a quota

### GitHub

Check:

- **Repository → Insights → Traffic** for traffic trends
- **Repository → Actions** for unexpected build frequency
- Repository size and large-file reports before adding media
- The local `npm run audit:footprint` report before committing assets

Keep public images optimized and small. Deleting a file from the current
branch does not remove it from Git history; removing a large historical file
requires a deliberate history rewrite and a backup first.

## Current migration boundary

The current prototype still uses the Express server and local JSON files.
Supabase migration should move plan/template persistence and admin
authorization to Supabase before GitHub Pages is used as the production host.
The frontend can remain static, and the existing individual-workout,
activity, and week template shapes can be stored as normalized snapshots.
