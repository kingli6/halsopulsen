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