---
name: Published plan sharing
description: The durable boundary and security limitations for personal plan links.
---

Published plans should be immutable snapshots once participant activity exists.
Before the first log or moved/skipped assignment, the owner may update the
current published version in place and keep its share token; after activity,
edits must create a new server-stored version.

**Why:** Early plan corrections should not create needless versions, but after
activity the published program must remain an accurate record of what happened.

**How to apply:** Expose “Edit current plan” only while the server reports no
participant activity. Otherwise expose “Edit as new version.” Keep the
participant route read-only for program structure, persist logs against the
snapshot, and replace the browser-held owner key before production use.

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

Deleting a published version should immediately revoke its participant link
and permanently remove its snapshot, logs, and historical references.

**Why:** The owner explicitly asked not to pay storage for unused data, and a
soft-delete policy would retain data without a restore feature.

**How to apply:** Require confirmation that names the plan and warns about
logs before deletion. Treat CSV as a human-readable export, not a reliable
backup format. If import or restart becomes necessary, define a versioned
private backup format separately.