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