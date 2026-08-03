# HälsoPulsen Personal Training Service — Project Log

## Big idea

Turn HälsoPulsen from a public group challenge page into a personal goal and
training service.

The core loop is:

> Define a goal → create a plan → publish the week → log what happened → see
> progress → adjust the next plan.

The first product is intentionally manual. The value to prove is whether a
well-structured plan and a low-friction log help a person make progress.

## Current product direction

The first version is for the owner and their partner, not commercial clients.
An administrator (the coach) creates and manages the exercise programs and
publishes a private link for each person.

The preferred workflow is:

1. The owner creates a person and a goal.
2. The owner creates a structured program in the planning workspace.
3. The owner gives each weekday its own workout, or leaves it open.
4. The owner publishes the program.
5. The person sees only the published version in the logging workspace.
6. The person records what they actually did.
7. The person can move an unfinished assignment to another open day.
8. The service keeps both the recommended date and the actual completion date.
9. Graphs show trends, consistency, difficulty, and other useful patterns.
10. CSV export makes the structured record portable.
11. The owner can revise the draft and publish a new version without changing
    completed history.

## MVP scope

Start with:

- One private person dashboard, with support for multiple people in the data
  model.
- Goals and recurring programs.
- Workouts containing exercises, sets, repetitions, duration, rest, and notes.
- Daily assignments generated from the approved program.
- Logging of planned versus completed work.
- Difficulty, energy, pain/discomfort, and free-form notes.
- Calendar/history view.
- Progress graphs.
- CSV export.
- An owner area for creating, reviewing, publishing, and adjusting programs.
- An optional “send to admin” progress report.

Use a squat program as the first example, but do not build a squat-only system.
The underlying model should also support hangs, running, mobility, and general
habits.

## Deliberately postponed

- Public leaderboards.
- Group challenges and social chat.
- Rewards, streak mechanics, and gamification.
- Medical or injury diagnosis.
- A general-purpose workout marketplace.

## Important product decisions

### Planning and logging are separate

The owner needs a space for thinking about goals, weeks, exercise selection,
and progression. The person needs a calmer space for seeing the current plan
and recording actual work. Publishing is the explicit handoff between those
spaces.

The current browser prototype separates the routes and stores draft and
published versions locally. The planning route is visibly marked as not
access-controlled yet; real private access requires server-side
authentication, storage, and participant-specific links.

### Recommended days, flexible completion

Schedules are recommendations, not deadlines. A person can move an unfinished
assignment to an open day. The system keeps the original recommended date and
the actual completion date so the user can learn which patterns work.

### Store structure, not just text

Goals, programs, weekdays, workouts, exercises, assignments, conditions, and
logs must be structured records. The published program is the source of truth
for what the person is supposed to do.

The dashboard needs to compare:

- What was planned.
- What was completed.
- How difficult it felt.
- What was missed or modified.
- Whether performance is improving.
- Whether the schedule or time of day affects consistency.

### Private-by-default design

The initial users are known personally, and public data may be acceptable for
this experiment. However, the app should still be private by default so the
product does not need to be redesigned before real users or more sensitive
health information are involved. A consent screen is useful, but consent does
not replace authentication, access control, or safe handling of API keys.

## Things to be careful about

- The current group challenge uses open Supabase tables and is not a suitable
  security foundation for personal records.
- Ambiguous goals need clarification rather than confident guesses.
- Reported pain should trigger a cautious response and, where appropriate,
  stopping or seeking professional advice.
- Every assignment needs a clear status: planned, completed, partial, skipped,
  or excused.
- A user should be able to correct a log without destroying the history of what
  changed.
- Time zones and local dates matter for daily assignments.
- Plan changes should have an audit trail and an approval state.
- Private invite links are convenient but can be forwarded; stronger
  authentication can be added if the app expands beyond personal use.
- Planning access must move server-side before real participant data is stored.

## Current work status

The first personal tracker foundation now lives at `/dashboard/`. The logging
workspace is separate from the owner planning workspace at `/dashboard/plan/`.
The current prototype now has server-backed admin sessions, published participant
links, owner previews, plan lifecycle controls, and a reusable library for
activities, complete day workouts, and seven-day weeks. The original group
challenge remains in the repository as reference material, but its route is
retired.

## Architecture decision — August 3, 2026

Keep the product simple and continue with this split:

- **GitHub/GitHub Pages:** frontend code and small public assets.
- **Supabase:** the planned production home for authentication, plans,
  assignments, logs, reusable templates, and file metadata/storage.
- **Gemini API:** optional and non-critical; add it only for useful coaching
  assistance, and call it from a protected server-side function rather than
  browser code.

Do not add the owner's always-on computer to the first production path. It may
be reconsidered later if large-file storage becomes a real cost or capacity
problem.

## Current implementation milestone

The local Express prototype now has practical anti-abuse guardrails:

- Bounded JSON request bodies.
- Basic per-IP limits for API traffic, mutations, and admin login attempts.
- `413` responses for oversized requests and `429` responses for rate limits.
- Limits on program weeks, activities per day, assignments, logs, history, and
  reusable templates.
- Generic API error responses that do not expose server details.
- API responses marked as non-cacheable while the prototype contains private
  records.

These are deliberately lightweight protections for the current single-process
prototype. They are not a replacement for Supabase Row Level Security or
edge-level rate limiting once the app is deployed publicly.

## Planned path from here

1. Finish and use the planning, publishing, reusable-library, and logging MVP.
2. Add focused behavior checks for duplicate/stale participant updates and
   time-zone/date handling.
3. Design the Supabase schema for owner identity, plan versions, assignments,
   logs, templates, and asset metadata.
4. Move authentication and private persistence behind Supabase Auth/RLS or
   protected server/Edge Function operations.
5. Import the existing local JSON plans/templates and verify the published-link
   lifecycle.
6. Point the static frontend at the Supabase-backed API and then use GitHub
   Pages for production hosting.
7. Add Gemini only after the structured training loop is stable; keep the core
   tracker functional when Gemini is unavailable.

The current local JSON files remain development storage until the Supabase
migration is deliberately implemented and verified.