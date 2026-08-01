---
name: Published plan sharing
description: The durable boundary and security limitations for personal plan links.
---

Published plans keep their version and share token while ongoing edits update
the current program. Completed, skipped, moved, and logged records stay
unchanged; future planned assignments are rebuilt from the updated program.
Creating a new version remains available for intentional branching or for
archived snapshots.

**Why:** A coach needs to correct or extend an active plan without forcing a
new version for every small adjustment, while the participant's past activity
must remain accurate.

**How to apply:** Expose “Edit current plan” for the current library item and
“Edit as new version” for archived items. On current-plan save, let the server
preserve non-planned activity and regenerate only future planned assignments.
Keep the participant route read-only for program structure, persist logs
against the snapshot, and replace the browser-held owner key before production
use.

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