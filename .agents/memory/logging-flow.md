---
name: Logging flow
description: Product rules for separating planned workouts from backfilled and standalone participant activity logs.
---

Selecting a date is a logging action, not a planning action. A participant can choose a past or open date and record either the planned workout or a standalone activity. Moving an unfinished assignment must remain an explicit action.

**Why:** Participants need to record what actually happened without accidentally changing the owner-created schedule, and extra activity should be useful without inflating planned-work completion.

**How to apply:** Keep planned logs linked to assignments; keep standalone logs unlinked and marked as other activity. Planned completion metrics should count only assignment-linked logs, while history and export can include both. Summary metrics should use one clearly labeled date window and avoid adding incompatible units such as reps, minutes, and kilometres into one total.

The participant page should put week navigation before the selected-day workout. Desktop and mobile use explicit previous/next week controls and Today plus a horizontally draggable day strip. Mouse or finger dragging browses the days; clicking a card selects it, and dragging beyond either edge moves to an adjacent week.

**Why:** The participant needs to choose a day and immediately see the corresponding work below it. A week-first layout makes that relationship clearer without inventing a separate calendar screen.

**How to apply:** Keep the selected day synchronized with the workout card. Preserve the explicit arrows and Today button as the dependable controls; treat dragging as a convenience, not the only navigation path.