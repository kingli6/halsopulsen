---
name: Session corrections
description: The participant rule for correcting current training records without changing archived plan history.
---

Participants can edit or delete current planned sessions and standalone activities. Deleting a current planned log reopens its assignment; archived versions and their logs remain read-only.

**Why:** Real training records often need correction, but changing an archived plan snapshot would undermine version history and make progress exports unreliable.

**How to apply:** Keep correction controls on current entries only. Preserve the original log ID and creation timestamp when editing, update the record in place, and send corrections through the same shared revision/request-ID save contract as new activity.

On a selected current-plan day, the primary action edits an existing planned log
or creates the planned log when none exists; a separate secondary action records
standalone activity. Standalone entries expose their own Edit action.

**Why:** “Add another activity” made the existing planned record feel immutable,
which encouraged duplicate logs instead of correcting yesterday’s entry.

**How to apply:** Keep planned and standalone records distinct, but make the
day-level actions explicit: edit planned work, log other activity, or skip/reopen
the planned assignment.