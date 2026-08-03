# HälsoPulsen

## Project overview

HälsoPulsen is being redesigned from a group fitness challenge into a personal
goal and training service. The first usable version stores structured plans and
logs, visualizes progress, and keeps the planning and logging experiences
separate.

The current repository is an imported HTML/CSS/JavaScript website with a
Node.js/Express server. The former Supabase-backed group challenge has been
retired; its idea is documented for a possible future mode, but its obsolete
implementation is no longer served.

## Product direction

Build the first version for the owner and their partner:

- An owner/admin creates goals and structured exercise programs in a private
  planning workspace.
- The local prototype stores owner drafts in browser storage and published plans
  plus shared participant state in local JSON behind the Express server.
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
- The lean production direction is GitHub/GitHub Pages for the frontend,
  Supabase for private structured data and access control, and Gemini only as an
  optional server-side coaching feature.
- Large-file storage on an always-on personal computer is deferred until there
  is a demonstrated need; it is not part of the first production path.

Start with a structured squat workout as the example, but keep the data model
general enough for multiple workouts, running, hangs, mobility, and habits.

## User preferences

- Prefer a practical, admin-led MVP with a clear planning-to-logging handoff.
- Keep goals, programs, assignments, conditions, and logs as structured data.
- Focus on individual progress before group/social features.
- Keep the existing stack where practical instead of migrating without a need.
- Make the interface useful for checking what was planned, what was completed,
  and what the trends mean.
- Prefer practical anti-abuse limits and clear monitoring over elaborate
  security infrastructure while the product is a small personal service.
- Be constructively critical of product and design ideas. Prefer familiar,
  proven patterns from tools people already understand, and avoid reinventing
  standard interactions or adding complexity without a clear user benefit.