---
name: Resource storage policy
description: Durable storage boundaries and cleanup rules for the GitHub Pages and Supabase target.
---

Public versioned website assets belong in the GitHub repository. Private,
changing coaching data belongs in Supabase. User-uploaded or private media
belongs in object storage with metadata and ownership in Postgres; never store
base64 media in database rows.

**Why:** GitHub Pages is static and public, while Supabase provides access
control and persistence. Mixing the two creates privacy, bandwidth, and
cleanup problems.

**How to apply:** Keep the repository small and images optimized. Store plan
logs and reusable workout snapshots as structured data, use immutable snapshots
only at publish/template boundaries, and make cleanup dry-run, reference-aware,
and auditable. Do not auto-delete user history or source assets.