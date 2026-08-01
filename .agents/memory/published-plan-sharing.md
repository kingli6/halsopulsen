---
name: Published plan sharing
description: The durable boundary and security limitations for personal plan links.
---

Published plans should be immutable snapshots. Each publish creates a new
server-stored version and a new random participant share token; later draft
edits must not change the already shared plan or its history.

**Why:** A participant link needs to work across browsers and devices, while
the owner needs a recoverable history of exactly what was shared.

**How to apply:** Keep the participant route read-only for program structure,
persist participant logs against the shared snapshot, and replace the current
browser-held owner key with real owner authentication before production use.

When creating a new version from an older plan, the server must re-read the
parent snapshot and make its assignments and logs authoritative. The editor's
submitted copy can be stale if a participant logged work while the owner was
editing.

**Why:** This prevents a version publish from silently dropping participant
activity recorded after the owner opened the draft.

The owner library should be the operational overview for published snapshots:
show which participant record and share link are attached, how many sessions
are planned, completed, or skipped, and optionally reveal progress without
changing the immutable program.

**Why:** Authoring and operational monitoring are different jobs. Keeping
progress behind an explicit owner toggle makes access intentional while
preserving the published plan as a read-only historical record.

**How to apply:** Treat current prototype usage counts as linked participant
records and logged sessions, not as unique share-link opens or multi-user
analytics until durable authentication and participant identity exist.