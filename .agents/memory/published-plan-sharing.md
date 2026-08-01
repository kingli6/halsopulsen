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

The owner library should stay focused on published snapshots: version, plan
identity, participant, share-link actions, and safe lifecycle controls. One
participant uses each published link by design; do not add open-count or
multi-user analytics.

**Why:** The product is for an individual coaching relationship, not a social
or analytics platform. Extra usage metrics add complexity without helping the
core planning and logging loop.

**How to apply:** Put participant consent for coach visibility on the logging
page when that access model is built. Keep public progress sharing separate
and defer it until the private workflow proves useful.

Deleting a published version should revoke its participant link and remove it
from the active owner library, while retaining its snapshot and logs in
recoverable storage until a real restore flow exists.

**Why:** A one-week regret timer is hidden state without a recovery surface.
Soft deletion protects valuable training history now without pretending that
permanent deletion and restoration are already designed.

**How to apply:** Treat CSV as a human-readable export, not a reliable backup
format. If import or restart becomes necessary, define a versioned private
backup format separately.