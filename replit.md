# HälsoPulsen

## Project overview

HälsoPulsen is being redesigned from a group fitness challenge into a personal
goal and training dashboard. The long-term product is an AI-assisted coach that
helps a person plan work, log what happened, understand progress, and adjust
assignments.

The current repository is an imported HTML/CSS/JavaScript website with a
Node.js/Express server and an older Supabase-backed group challenge prototype.
The existing challenge code is reference material for the redesign, not the
final product model.

## Product direction

Build the first version for the owner and their partner:

- An admin/coach creates goals and structured exercise programs.
- AI may prepare drafts and recommendations.
- The admin or user approves important changes.
- Each person receives a private dashboard link.
- The person logs planned versus completed work.
- The dashboard includes history, graphs, and contextual AI coaching.
- Progress can optionally be sent to the admin for review.

Start with a structured squat workout as the example, but keep the data model
general enough for multiple workouts, running, hangs, mobility, and habits.

## User preferences

- Prefer a practical, admin-led MVP before autonomous AI behavior.
- Keep goals, programs, assignments, conditions, and logs as structured data.
- Use AI for clarification, drafting, analysis, conversation, and proposals;
  do not let it silently publish important plan changes.
- Focus on individual progress before group/social features.
- Keep the existing stack where practical instead of migrating without a need.
- Make the interface useful for checking what was planned, what was completed,
  and what the trends mean.