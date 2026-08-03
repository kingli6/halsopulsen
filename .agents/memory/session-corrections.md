---
name: Session corrections
description: The participant rule for correcting current training records without changing archived plan history.
---

Participants can edit or delete current planned sessions and standalone activities. Deleting a current planned log reopens its assignment; archived versions and their logs remain read-only.

**Why:** Real training records often need correction, but changing an archived plan snapshot would undermine version history and make progress exports unreliable.

**How to apply:** Keep correction controls on current entries only. Preserve the original log ID and creation timestamp when editing, update the record in place, and send corrections through the same shared revision/request-ID save contract as new activity.

On a selected current-plan day, the primary action edits an existing planned log
or creates the planned log when none exists; a separate secondary action records
standalone activity. Standalone entries expose their own Edit action. A past
current-plan session remains editable, while an archived session stays read-only.

**Why:** “Add another activity” made the existing planned record feel immutable,
which encouraged duplicate logs instead of correcting yesterday’s entry.

**How to apply:** Keep planned and standalone records distinct, but make the
day-level actions explicit: edit planned work, log other activity, or
mark/restore the planned assignment as missed.

Planned-session completion is explicit. Saving workout metrics without checking
completion creates a recorded-but-incomplete log; only checked planned logs
count toward completion metrics. Existing logs without the field remain
completed for backward compatibility.

**Why:** Recording partial work is useful, but logging details alone should not
claim that the assigned workout was finished.

**How to apply:** Store the completion state on planned logs, show Recorded
versus Completed in the day strip, history, chart, and exports, and keep the
checkbox visible only for planned-workout forms.