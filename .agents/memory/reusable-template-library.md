---
name: Reusable template library
description: Rules for reusable activity, day-workout, and week snapshots in the owner planner.
---

The owner library stores normalized, server-backed snapshots at three levels:
activities, complete day workouts, and seven-day weeks. Inserting a snapshot
copies it into the current draft; it never edits the saved library item.

**Why:** Repeated plan setup is common, and browser-only clipboard state would
not survive devices or sessions. Snapshot copies keep reuse predictable while
letting future drafts be customized independently.

**How to apply:** Activity insertion appends to a chosen day. Day insertion
replaces the chosen day only after confirmation. Week insertion replaces the
selected draft week only after confirmation. Keep library access owner-only and
do not expose templates on participant links.