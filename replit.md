# HälsoPulsen

## Project overview

HälsoPulsen is being redesigned from a group fitness challenge into a personal
goal and training service. The first usable version stores structured plans and
logs, visualizes progress, and keeps the planning and logging experiences
separate.

The current repository is an imported HTML/CSS/JavaScript website with a
Node.js/Express server and an older Supabase-backed group challenge prototype.
The existing challenge code is reference material for the redesign, not the
final product model.

## Product direction

Build the first version for the owner and their partner:

- An owner/admin creates goals and structured exercise programs in a private
  planning workspace.
- The first prototype stores one person's program and logs in the browser.
- The owner plans each weekday separately, then publishes a version.
- A program can contain multiple independently editable weeks; one publish creates the complete multi-week snapshot.
- Reusable activity, day-workout, and week snapshots live in a separate owner library and can be inserted into future drafts.
- The participant sees the published version in a separate logging workspace.
- Recommended days are flexible; unfinished assignments can be moved to an
  open day.
- The person logs planned versus completed work.
- The logging workspace includes history, graphs, and CSV export.
- The owner area uses a secure admin session; participant pages use bearer links
  for this prototype.

Start with a structured squat workout as the example, but keep the data model
general enough for multiple workouts, running, hangs, mobility, and habits.

## User preferences

- Prefer a practical, admin-led MVP with a clear planning-to-logging handoff.
- Keep goals, programs, assignments, conditions, and logs as structured data.
- Focus on individual progress before group/social features.
- Keep the existing stack where practical instead of migrating without a need.
- Make the interface useful for checking what was planned, what was completed,
  and what the trends mean.