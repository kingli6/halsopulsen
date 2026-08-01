---
name: Personal coaching direction
description: Product decisions for the HälsoPulsen redesign from group challenges to a manual personal training service.
---

The first product should be a simple personal goal and training service.
The owner creates a structured program in a private planning workspace, gives
each weekday its own workout, and publishes a version. The person uses a
separate logging workspace that shows the published plan, records actual work,
and exports clean CSV data.

**Why:** Separating planning from logging mirrors the real service relationship:
the owner needs authoring and publishing controls while the person needs a
calm, focused record of the work.

**How to apply:** Keep goals, programs, weekdays, workouts, exercises,
assignments, conditions, and logs as structured records. Keep recommended days
flexible: users can move unfinished work and the app preserves both the
recommended and actual dates. Treat publishing as the boundary between the
owner's draft and the person's live log.

Use three activity prescription formats rather than sport-specific types:
strength exercise, cardio activity, and guided session. Keep workout structure
(such as intervals) separate from effort (such as Easy, Hard, or RIR).

**Why:** A run is an activity, intervals are a structure, and intensity is an
effort target. Separating them makes the editor understandable while still
covering running, cycling, classes, videos, mobility, and timed strength work.

Strength tempo uses four numbers in the order eccentric/lowering, bottom pause,
concentric/lifting, and top pause; `3-1-1-0` is the canonical example.

**Why:** The four-part notation removes ambiguity about pauses and keeps tempo
distinct from rest between sets.

Workout editing has two levels: the workout overview describes the whole day
(title, session-wide note, main focus, warm-up, and cool-down), while activities
contain the specific exercises, cardio blocks, or guided sessions and their
prescriptions.

**Why:** Separating session context from prescribed activities prevents users
from confusing a day label or warm-up instruction with an individual exercise.

Place the add-activity action at the end of the activity list, directly below
where the new card appears, and focus the new card after it is created.

**Why:** Users need immediate visual confirmation that an activity was added and
should not have to search or scroll through a long modal to begin editing it.

Programs may contain multiple independently editable weeks. Each week owns its
phase, progression guidance, success metric, and seven-day schedule; publishing
captures all weeks in one immutable program version and share link.

**Why:** Real programming changes across phases, while one share link and one
version keep the participant experience and historical logs coherent.

**How to apply:** Select the active week while authoring, derive the participant's
week from the program start calendar week, and preserve the week number on every
generated assignment.