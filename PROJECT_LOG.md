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

The public homepage no longer promotes the tracker or the old group-challenge
idea. When the tracker is ready to show publicly, replace that space with a
small, truthful example of logging a workout and using the resulting history
and statistics—not an admin link or a promise of public competition.

## Status snapshot — August 3, 2026

### Working now

- The owner can create structured goals, multi-week programs, weekday workouts,
  exercises, progression guidance, and recommended assignments.
- The owner can publish a version, preview the participant view, revise a draft,
  and reuse saved activity, day-workout, and week snapshots.
- Participants use a separate logging workspace through a private published
  link. They can log planned sessions, backfill a date, move unfinished work,
  mark a workout skipped, or record an extra activity without changing the
  plan.
- Logs include planned versus completed values, intensity, difficulty, energy,
  and notes. History, progress summaries, charts, and CSV export are available.
- Current planned sessions and extra activities can be edited or deleted.
  Deleting a planned log reopens its assignment. Archived plan history remains
  immutable.
- Shared participant saves use a revision number and request ID. Duplicate
  requests are idempotent, stale updates are rejected, and the participant is
  offered an explicit reload after a conflict.
- The local Express app has bounded request bodies, lightweight API/login rate
  limits, collection limits, generic API errors, and non-cacheable private
  responses.

### Recent reliability work

- Added `npm run test:shared-log`, a repeatable regression check for legacy
  revision zero, first save, duplicate replay, stale conflict, sequential saves,
  and preservation of stored assignments/logs.
- Fixed the new-session logging button so it opens a new log instead of passing
  the browser click event into the edit-session path.
- The workflow is currently running cleanly on port 5000 with syntax, route,
  served-asset, regression, and diff checks passing.

### Prototype boundaries

- Owner drafts still use browser storage.
- Published plans and shared participant state still use local JSON files behind
  the Express server.
- Admin authentication and bearer links are prototype access controls, not a
  production identity and permissions system.
- There is not yet a production database, Row Level Security, deployment
  pipeline, or full browser end-to-end test suite.
- Time-zone and local-date behavior still needs focused automated checks before
  the tracker is trusted with longer-running real use.

### Participant logging page design direction

The participant's primary job is simple:

> See what I need to do today → understand the workout → log what happened.

The current page is visually polished, but its hierarchy is too dashboard-like.
The goal strip comes first, the “Up next” card is only part of a two-column
section, and the dark explanatory card competes strongly for attention. In the
first viewport, the actual workout details are pushed low and compressed into a
single summary line. That makes the important task feel secondary.

The recommended order is:

1. A compact page header, followed immediately by the **week selector**.
2. A prominent, full-width selected-day workout section with the workout title,
   clear task rows, prescription details, and one obvious **Log workout** action.
3. The current goal and weekly progress summary.
4. Progress and recent history.
5. Explanatory notes and storage/link information as secondary content.

The week selector keeps explicit previous/next arrows and a Today button. The
seven day cards form a horizontal draggable strip on desktop and mobile. A
mouse or finger can grab and drag the strip; clicking a card still selects the
day. Dragging beyond its left or right edge changes the week. This keeps the
familiar week controls while making the day-to-workout relationship obvious on
a narrow screen.

Use familiar task and training-app conventions rather than inventing a new
interaction model: “Today,” a scannable checklist or activity list, a clear
start/log action, and compact status labels. Keep the custom visual style, but
do not let decorative cards or aggregate metrics outrank the next action.

## Where we are going next

Work in this order:

1. Use the planner and logger with a small amount of realistic training data.
   Confirm that assignments, moved sessions, backfilled dates, corrections,
   history, charts, and CSV export reflect actual use.
2. Add focused automated checks for participant corrections and local-date/time-
   zone edge cases, alongside the existing shared-save regression test.
3. Protect participant data and admin controls before inviting more people:
   move authorization and private persistence out of browser/local JSON
   assumptions and define the owner/participant access boundary.
4. Design the production Supabase schema and migration for identities, plan
   versions, assignments, logs, reusable templates, and asset metadata. Import
   and verify the current local examples before changing hosting.
5. Move the static frontend and protected API path toward GitHub/GitHub Pages
   plus Supabase Auth/RLS or protected server/Edge Functions.
6. Add optional Gemini coaching only after the structured planning, logging, and
   statistics loop is stable. The tracker must remain useful when AI is absent.
7. Keep group challenges, leaderboards, chat, rewards, and social features
   deferred until individual use shows which comparison or community behaviors
   are genuinely valuable.

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

## Homepage trimming notes

Keep the public page focused on the current practice offer:

- Hero and booking call to action.
- Current services and the reason they are free.
- About, qualifications, and contact options.

Review these items before the next public refresh:

- Remove or simplify the progress tracker when the practice-period numbers are
  no longer useful.
- The free workout-tools promotion now lives on the training guide rather than
  taking space on the homepage.
- Replace the third-party contact form with a protected or simpler contact path
  if spam becomes a problem; the current static form disables the provider's
  CAPTCHA and should not be treated as a strong anti-bot boundary.
- Keep `/admin` and participant tracker routes out of public navigation unless a
  visitor-facing explanation and access flow exists.

The free workout-tools promotion has been removed from the homepage and moved
to the training guide. The homepage otherwise remains focused on the current
practice offer.

## Future group challenge direction

The old group-challenge prototype is no longer a public product or public link.
Its route redirects to the homepage, crawlers are asked not to index it, and the
obsolete implementation has been removed from the served repository.

The idea is worth preserving, but it should not be polished by extending the
old implementation as-is. A future version should be built on the individual
tracker foundation and add only the group features that are actually wanted:

- A challenge has a clear goal, dates, rules, and activity definition.
- Participants use stable accounts or invite links with explicit privacy
  expectations.
- Personal logs remain the source data; rankings are a separate presentation.
- Participants can see their own history even if they hide from rankings.
- Leaderboards have clear tie handling, time-zone rules, and anti-spam limits.
- Community chat is optional and moderated rather than assumed.
- Owner controls include pause, close, corrections, and data export.
- The challenge must work without AI commentary; Gemini can remain optional.

The best sequence is: finish the individual plan/log/statistics loop, observe
what people actually want to compare, then design a small challenge mode around
those proven behaviors. Do not reuse the old open Supabase tables or its
leaderboard/chat model for real participant data.