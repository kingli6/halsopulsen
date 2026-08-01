# HälsoPulsen

## Project overview

HälsoPulsen is being redesigned from a group fitness challenge into a personal
goal and training dashboard. The long-term product may become an AI-assisted
coach, but the first usable version is intentionally AI-free: it stores
structured plans and logs, visualizes progress, and exports clean data for
analysis in any AI tool.

The current repository is an imported HTML/CSS/JavaScript website with a
Node.js/Express server and an older Supabase-backed group challenge prototype.
The existing challenge code is reference material for the redesign, not the
final product model.

## Product direction

Build the first version for the owner and their partner:

- An admin/coach creates goals and structured exercise programs.
- The first prototype stores one person's program in the browser.
- Recommended days are flexible; unfinished assignments can be moved to an
  open day.
- The person logs planned versus completed work.
- The dashboard includes history, graphs, CSV export, and an AI-ready copy
  summary.
- A later version can add an admin area and private links for multiple people.

Start with a structured squat workout as the example, but keep the data model
general enough for multiple workouts, running, hangs, mobility, and habits.

## User preferences

- Prefer a practical, admin-led MVP before autonomous AI behavior.
- Keep goals, programs, assignments, conditions, and logs as structured data.
- Keep the first version AI-free and make exported data easy to analyse in any
  external AI tool.
- Focus on individual progress before group/social features.
- Keep the existing stack where practical instead of migrating without a need.
- Make the interface useful for checking what was planned, what was completed,
  and what the trends mean.