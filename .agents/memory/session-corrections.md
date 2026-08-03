---
name: Session corrections
description: The participant rule for correcting current training records without changing archived plan history.
---

Participants can edit planned sessions and standalone activities from past dates,
including a session whose plan version has since moved into history. The workout
prescription remains an immutable snapshot; saving a correction creates or
updates the session in the current shared state without rewriting that snapshot.
Current planned logs and standalone activities can be deleted; archived-session
corrections are not deleted from the historical snapshot.

**Why:** Real training records often need correction, but changing an archived
plan snapshot would undermine version history and make progress exports
unreliable. A session becoming historical because a new plan was published
should not make yesterday's record uncorrectable.

**How to apply:** Keep correction controls on saved past entries, preserve the
original log ID and creation timestamp when editing, and send corrections
through the same shared revision/request-ID save contract as new activity.
When the source assignment is archived, write the corrected log into current
state while leaving its historical assignment and original snapshot unchanged.

On a selected planned day in the past, the primary action is always an explicit
Edit workout action: it edits the saved planned log when one exists or opens the
planned-workout form when the day has not been logged yet. A separate secondary
action records standalone activity. Standalone entries expose their own Edit
action. The archived prescription stays read-only, but its past session remains
correctable.

**Why:** “Add another activity” made the existing planned record feel immutable,
which encouraged duplicate logs instead of correcting yesterday’s entry.

**How to apply:** Keep planned and standalone records distinct, but make the
day-level actions explicit: edit planned work, log other activity, or
mark/restore the planned assignment as missed. Do not offer delete for an
archived correction overlay.

Planned-session completion is explicit. Saving workout metrics without checking
completion creates a recorded-but-incomplete log; only checked planned logs
count toward completion metrics. Existing logs without the field remain
completed for backward compatibility.

**Why:** Recording partial work is useful, but logging details alone should not
claim that the assigned workout was finished.

**How to apply:** Store the completion state on planned logs, show Recorded
versus Completed in the day strip, history, chart, and exports, and keep the
checkbox visible only for planned-workout forms.