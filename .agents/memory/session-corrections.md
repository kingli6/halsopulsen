---
name: Session corrections
description: The participant rule for correcting current training records without changing archived plan history.
---

Participants can edit or delete current planned sessions and standalone activities. Deleting a current planned log reopens its assignment; archived versions and their logs remain read-only.

**Why:** Real training records often need correction, but changing an archived plan snapshot would undermine version history and make progress exports unreliable.

**How to apply:** Keep correction controls on current entries only. Preserve the original log ID and creation timestamp when editing, update the record in place, and send corrections through the same shared revision/request-ID save contract as new activity.