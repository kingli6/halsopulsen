# HälsoPulsen Personal Coaching — Project Log

## Big idea

Turn HälsoPulsen from a public group challenge page into a personal goal and
training coach.

The core loop is:

> Define a goal → create a plan → receive today's assignment → log what
> happened → see progress → receive feedback → adapt the next assignment.

The longer-term vision is that several individuals can optionally join hands
around similar goals and let an AI coach support the group. That is not part of
the first build.

## Current product direction

The first version is for the owner and their partner, not commercial clients.
An administrator (the coach) creates and manages the exercise programs and
publishes a private link for each person.

The preferred workflow is:

1. The admin creates a person and a goal.
2. The admin creates a structured program.
3. The admin publishes the program and sends the person a private dashboard link.
4. The person sees recommended assignments and records what they actually did.
5. The person can move an unfinished assignment to another open day.
6. The dashboard keeps both the recommended date and the actual completion date.
7. Graphs show trends, consistency, difficulty, and other useful patterns.
8. The person exports a CSV or copies an AI-ready summary for analysis in any
   external AI tool.
9. A future AI layer can give feedback and propose changes, but important plan
   changes should be shown to the admin or user for approval before they are applied.
10. The person can optionally send a progress snapshot to the admin, or keep
    their logs private.

## What the AI should do

AI is postponed from the first implementation. The product should still
produce clean, structured data for analysis elsewhere.

When an AI layer is added later, it could:

- Turning a natural-language goal into a structured draft program.
- Asking clarifying questions about schedule, equipment, intensity, and
  constraints.
- Turning a program into today's and this week's assignments.
- Reading the person's approved plan and logged results.
- Explaining trends and answering questions about the person's own data.
- Proposing progression, regression, recovery, or schedule changes.
- Creating structured assignment and condition proposals for review.

The AI should not silently invent or publish a new training plan. It should
return structured, validated proposals that the application can preview and
that the admin or user can approve.

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
- CSV export and copyable AI-ready summaries (AI integration postponed).
- An admin area for creating, reviewing, publishing, and adjusting programs.
- An optional “send to admin” progress report.

Use a squat program as the first example, but do not build a squat-only system.
The underlying model should also support hangs, running, mobility, and general
habits.

## Deliberately postponed

- Public leaderboards.
- Group challenges and social chat.
- Autonomous AI plan changes.
- Rewards, streak mechanics, and gamification.
- Medical or injury diagnosis.
- A general-purpose workout marketplace.

## Important product decisions

### Admin-led is the longer-term direction

The admin-authoring workflow is easier to build and easier to trust than
letting an AI independently create and publish dashboards. The first build
keeps program setup simple and manual. A later AI-assisted admin command can
produce a draft the admin can inspect, edit, and publish.

### Recommended days, flexible completion

Schedules are recommendations, not deadlines. A person can move an unfinished
assignment to an open day. The system keeps the original recommended date and
the actual completion date so the user can learn which patterns work.

### Store structure, not just chat

Goals, programs, exercises, assignments, conditions, and logs must be
structured records. Chat is an interface for asking questions and proposing
changes; it is not the source of truth for what the person is supposed to do.

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
- AI-generated plans must be validated before they become database records.
- Ambiguous goals need clarification rather than confident guesses.
- The AI must not diagnose pain or injury; reported pain should trigger a
  cautious response and, where appropriate, stopping or seeking professional
  advice.
- Every assignment needs a clear status: planned, completed, partial, skipped,
  or excused.
- A user should be able to correct a log without destroying the history of what
  changed.
- Time zones and local dates matter for daily assignments.
- Plan changes should have an audit trail and an approval state.
- Private invite links are convenient but can be forwarded; stronger
  authentication can be added if the app expands beyond personal use.
- If an AI integration is added later, calls belong on the server. No OpenAI
  secret should be shipped to browser code.

## Current work status

The first personal tracker foundation now lives at `/dashboard/`. It is a
local-first browser prototype with structured programs, flexible day tiles,
completion logging, progress visualisation, and CSV/AI-ready export. The
original group challenge remains available at `/challenge/` as reference
material. The next phase can decide whether to persist multiple people and
private links in Supabase.