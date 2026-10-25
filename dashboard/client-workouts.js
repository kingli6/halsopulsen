(function attachClientWorkoutWorkspace(root) {
  "use strict";

  const weekdays = [
    { offset: 0, label: "Monday", short: "Mon" },
    { offset: 1, label: "Tuesday", short: "Tue" },
    { offset: 2, label: "Wednesday", short: "Wed" },
    { offset: 3, label: "Thursday", short: "Thu" },
    { offset: 4, label: "Friday", short: "Fri" },
    { offset: 5, label: "Saturday", short: "Sat" },
    { offset: 6, label: "Sunday", short: "Sun" }
  ];

  const workoutTemplates = [
    {
      id: "strength-a",
      weekday: 0,
      name: "Full-body strength A",
      type: "Strength",
      duration: 45,
      status: "completed",
      description: "A steady full-body session with a comfortable pace and controlled reps.",
      warmup: "5 min easy walk, then a few light practice reps.",
      cooldown: "Easy walk until your breathing settles.",
      exercises: [
        { id: "goblet-squat", name: "Goblet squat", sets: 3, reps: 8, weight: 20, rest: 90, instruction: "Pause briefly at a comfortable depth." },
        { id: "incline-push-up", name: "Incline push-up", sets: 3, reps: 10, weight: null, rest: 60, instruction: "Use a stable surface that lets you keep a smooth tempo." },
        { id: "dumbbell-row", name: "One-arm dumbbell row", sets: 3, reps: 10, weight: 12, rest: 60, instruction: "10 reps each side." }
      ]
    },
    {
      id: "easy-aerobic",
      weekday: 2,
      name: "Easy cardio + mobility",
      type: "Cardio",
      duration: 35,
      status: "planned",
      description: "Build an easy aerobic base without chasing pace.",
      warmup: "Start with five minutes at a relaxed pace.",
      cooldown: "Finish with an easy walk and gentle mobility.",
      exercises: [
        { id: "walk-jog", name: "Outdoor walk or easy jog", sets: 1, reps: 30, weight: null, rest: 0, instruction: "30 minutes at a conversational effort; walk whenever needed." },
        { id: "hip-mobility", name: "Hip mobility flow", sets: 1, reps: 5, weight: null, rest: 0, instruction: "Move smoothly through a comfortable range on each side." }
      ]
    },
    {
      id: "strength-b",
      weekday: 4,
      name: "Strength B",
      type: "Strength",
      duration: 50,
      status: "planned",
      description: "A lower-body and trunk session focused on balance and control.",
      warmup: "5 min brisk walk and a few easy bodyweight repetitions.",
      cooldown: "Gentle breathing and relaxed hip mobility.",
      exercises: [
        { id: "reverse-lunge", name: "Reverse lunge", sets: 3, reps: 8, weight: null, rest: 75, instruction: "8 reps each side; hold support if useful." },
        { id: "glute-bridge", name: "Glute bridge", sets: 3, reps: 12, weight: null, rest: 60, instruction: "Pause briefly at the top of each repetition." },
        { id: "dead-bug", name: "Dead bug", sets: 3, reps: 8, weight: null, rest: 45, instruction: "8 reps each side; keep the movement controlled." }
      ]
    },
    {
      id: "recovery-mobility",
      weekday: 5,
      name: "Recovery mobility",
      type: "Mobility",
      duration: 20,
      status: "planned",
      description: "An optional low-effort session to finish the week feeling refreshed.",
      warmup: "Begin with a few relaxed breaths and easy movement.",
      cooldown: "No extra cool-down needed.",
      exercises: [
        { id: "shoulder-flow", name: "Shoulder mobility flow", sets: 2, reps: 8, weight: null, rest: 30, instruction: "Move slowly without forcing your range." },
        { id: "ankle-mobility", name: "Ankle rocks", sets: 2, reps: 10, weight: null, rest: 30, instruction: "10 gentle repetitions per side." }
      ]
    }
  ];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function dateFromISO(value) {
    const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function toISO(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function addDays(value, amount) {
    const date = dateFromISO(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return toISO(date);
  }

  function mondayOf(date) {
    const monday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return toISO(monday);
  }

  function dateLabel(value, options) {
    return dateFromISO(value).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      ...options
    });
  }

  function weekLabel(weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const start = dateFromISO(weekStart);
    const end = dateFromISO(weekEnd);
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    const startLabel = dateLabel(weekStart, { day: "numeric", ...(sameMonth ? {} : { month: "short" }) });
    const endLabel = dateLabel(weekEnd, { day: "numeric", month: "short", year: "numeric" });
    return `${startLabel}–${endLabel}`;
  }

  function createState(now = new Date()) {
    return {
      weekStart: mondayOf(now),
      screen: "overview",
      selectedWorkoutId: null,
      sessions: {}
    };
  }

  function sessionKey(state, workout) {
    return `${state.weekStart}:${workout.id}`;
  }

  function getWorkouts(weekStart) {
    return workoutTemplates.map(template => ({
      ...template,
      date: addDays(weekStart, template.weekday),
      exercises: template.exercises.map(exercise => ({ ...exercise }))
    }));
  }

  function getWorkout(state) {
    return getWorkouts(state.weekStart).find(workout => workout.id === state.selectedWorkoutId) || null;
  }

  function statusFor(state, workout) {
    const session = state.sessions[sessionKey(state, workout)];
    return session?.finished ? "completed" : workout.status;
  }

  function ensureSession(state, workout) {
    const key = sessionKey(state, workout);
    if (state.sessions[key]) return state.sessions[key];
    const completed = workout.status === "completed";
    const session = {
      finished: completed,
      notes: completed ? "Good energy; kept the final set smooth." : "",
      exercises: {}
    };
    workout.exercises.forEach(exercise => {
      session.exercises[exercise.id] = Array.from({ length: exercise.sets }, () => ({
        reps: exercise.reps ?? "",
        weight: exercise.weight ?? "",
        completed
      }));
    });
    state.sessions[key] = session;
    return session;
  }

  function setResult(state, workout, exerciseId, setIndex, field, value) {
    if (!["reps", "weight"].includes(field)) return;
    const session = ensureSession(state, workout);
    const set = session.exercises[exerciseId]?.[setIndex];
    if (!set || session.finished) return;
    set[field] = value;
  }

  function setCompleted(state, workout, exerciseId, setIndex, completed) {
    const session = ensureSession(state, workout);
    const set = session.exercises[exerciseId]?.[setIndex];
    if (!set || session.finished) return;
    set.completed = Boolean(completed);
  }

  function setNotes(state, workout, notes) {
    const session = ensureSession(state, workout);
    if (!session.finished) session.notes = notes;
  }

  function renderOverview(state) {
    const workouts = getWorkouts(state.weekStart);
    const cards = weekdays.map(day => {
      const workout = workouts.find(item => item.weekday === day.offset);
      const dayDate = addDays(state.weekStart, day.offset);
      if (!workout) {
        return `<article class="client-workout-day is-rest">
          <div class="client-workout-day-date"><strong>${day.short}</strong><span>${dateLabel(dayDate, { day: "numeric", month: "short" })}</span></div>
          <div class="client-workout-day-content"><strong>No workout planned</strong><span>Rest / open day</span></div>
          <span class="client-workout-rest-mark" aria-hidden="true">—</span>
        </article>`;
      }
      const status = statusFor(state, workout);
      return `<button class="client-workout-day is-workout" type="button" data-workout-action="open-workout" data-workout-id="${workout.id}" aria-label="Open ${escapeHtml(workout.name)}, ${status === "completed" ? "completed" : "planned"}">
        <span class="client-workout-day-date"><strong>${day.short}</strong><span>${dateLabel(dayDate, { day: "numeric", month: "short" })}</span></span>
        <span class="client-workout-day-content"><strong>${escapeHtml(workout.name)}</strong><span>${escapeHtml(workout.type)} · ${workout.duration} min · ${workout.exercises.length} ${workout.exercises.length === 1 ? "exercise" : "exercises"}</span></span>
        <span class="client-workout-status is-${status}">${status === "completed" ? "Completed" : "Planned"}</span>
        <span class="client-workout-chevron" aria-hidden="true">›</span>
      </button>`;
    }).join("");

    return `<section class="client-workouts">
      <header class="client-workouts-heading">
        <div><p class="planner-eyebrow">YOUR TRAINING</p><h1>Workouts</h1>
          <p class="planner-lede">Your week at a glance. Open a workout to see the plan or record what you actually did.</p></div>
        <span class="client-workout-mock-note">Sample workouts · edits stay in this preview</span>
      </header>
      <section class="client-workout-weekbar" aria-label="Workout week navigation">
        <button class="planner-button planner-button-icon" type="button" data-workout-action="previous-week" aria-label="Previous week">‹</button>
        <div class="client-workout-week-label"><span>WEEK OF</span><strong>${weekLabel(state.weekStart)}</strong></div>
        <button class="planner-button planner-button-icon" type="button" data-workout-action="next-week" aria-label="Next week">›</button>
      </section>
      <section class="client-workout-week-list" aria-label="Workouts by day">${cards}</section>
      <p class="client-workout-footnote">A recorded session saves your actual results in this preview. It does not change the prescribed workout.</p>
    </section>`;
  }

  function renderDetails(state, workout) {
    const status = statusFor(state, workout);
    const exercises = workout.exercises.map((exercise, index) => {
      const prescription = exercise.weight == null
        ? `${exercise.sets} × ${exercise.reps} ${exercise.id === "walk-jog" ? "min" : "reps"}`
        : `${exercise.sets} × ${exercise.reps} reps · ${exercise.weight} kg`;
      const rest = exercise.rest ? `${exercise.rest} sec rest` : "";
      return `<article class="client-workout-exercise">
        <span class="client-workout-exercise-number">${index + 1}</span>
        <div><h3>${escapeHtml(exercise.name)}</h3><p>${escapeHtml(prescription)}${rest ? ` · ${rest}` : ""}</p>
          ${exercise.instruction ? `<small>${escapeHtml(exercise.instruction)}</small>` : ""}
        </div>
      </article>`;
    }).join("");

    return `<section class="client-workouts">
      <button class="client-workout-back" type="button" data-workout-action="back-to-week">‹ Back to week overview</button>
      <header class="client-workout-detail-head">
        <div><p class="planner-eyebrow">${escapeHtml(workout.type)} · ${dateLabel(workout.date, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1>${escapeHtml(workout.name)}</h1><p class="planner-lede">${escapeHtml(workout.description)}</p></div>
        <span class="client-workout-status is-${status}">${status === "completed" ? "Completed" : "Planned"}</span>
      </header>
      <div class="client-workout-detail-meta"><span>◷ ${workout.duration} min</span><span>${workout.exercises.length} exercises</span></div>
      ${workout.warmup ? `<section class="client-workout-note-card"><strong>Warm-up</strong><p>${escapeHtml(workout.warmup)}</p></section>` : ""}
      <section class="client-workout-detail-card"><header><div><h2>Exercise plan</h2><p>Prescribed sets, repetitions and rest periods.</p></div></header><div class="client-workout-exercise-list">${exercises}</div></section>
      ${workout.cooldown ? `<section class="client-workout-note-card"><strong>Cool-down</strong><p>${escapeHtml(workout.cooldown)}</p></section>` : ""}
      <div class="client-workout-detail-actions">
        <button class="planner-button planner-button-primary" type="button" data-workout-action="record-workout">${status === "completed" ? "View recorded session" : "Record workout"}</button>
      </div>
    </section>`;
  }

  function renderRecording(state, workout) {
    const session = ensureSession(state, workout);
    const exerciseCards = workout.exercises.map((exercise, exerciseIndex) => {
      const results = session.exercises[exercise.id] || [];
      const rows = results.map((result, setIndex) => `<div class="client-workout-set-row">
        <strong>Set ${setIndex + 1}</strong>
        <label><span>Reps / duration</span><input type="number" min="0" step="any" data-workout-result="reps" data-exercise-id="${exercise.id}" data-set-index="${setIndex}" value="${escapeHtml(result.reps)}" ${session.finished ? "disabled" : ""}></label>
        <label><span>Weight · kg</span><input type="number" min="0" step="any" data-workout-result="weight" data-exercise-id="${exercise.id}" data-set-index="${setIndex}" value="${escapeHtml(result.weight)}" ${session.finished ? "disabled" : ""}></label>
        <label class="client-workout-set-check"><input type="checkbox" data-workout-complete-set data-exercise-id="${exercise.id}" data-set-index="${setIndex}" ${result.completed ? "checked" : ""} ${session.finished ? "disabled" : ""}><span>Done</span></label>
      </div>`).join("");
      return `<section class="client-workout-record-exercise">
        <header><span class="client-workout-exercise-number">${exerciseIndex + 1}</span><div><h3>${escapeHtml(exercise.name)}</h3><p>Prescribed: ${exercise.sets} × ${exercise.reps}${exercise.weight == null ? "" : ` · ${exercise.weight} kg`}</p></div></header>
        <div class="client-workout-set-list">${rows}</div>
      </section>`;
    }).join("");
    const completedBanner = session.finished
      ? `<div class="client-workout-complete-banner" role="status"><strong>Session recorded</strong><span>Your actual results are saved in this preview. The prescribed workout was not changed.</span></div>`
      : "";

    return `<section class="client-workouts">
      <button class="client-workout-back" type="button" data-workout-action="open-details">‹ Back to workout details</button>
      <header class="client-workout-detail-head">
        <div><p class="planner-eyebrow">RECORDING SESSION · ${dateLabel(workout.date, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1>${escapeHtml(workout.name)}</h1><p class="planner-lede">Log what you actually performed. Your prescribed workout stays as written.</p></div>
      </header>
      ${completedBanner}
      <section class="client-workout-record-card">
        ${exerciseCards}
        <label class="client-workout-notes"><span>Session notes</span><textarea data-workout-notes placeholder="How did the session feel?" ${session.finished ? "disabled" : ""}>${escapeHtml(session.notes)}</textarea></label>
        ${session.finished
          ? `<button class="planner-button" type="button" data-workout-action="back-to-week">Back to week overview</button>`
          : `<button class="planner-button planner-button-primary" type="button" data-workout-action="finish-session">Finish session</button>`}
      </section>
    </section>`;
  }

  function render(state) {
    if (state.screen === "details") {
      const workout = getWorkout(state);
      if (workout) return renderDetails(state, workout);
      state.screen = "overview";
    }
    if (state.screen === "recording") {
      const workout = getWorkout(state);
      if (workout) return renderRecording(state, workout);
      state.screen = "overview";
    }
    return renderOverview(state);
  }

  function handleAction(state, action, workoutId) {
    if (action === "previous-week") {
      state.weekStart = addDays(state.weekStart, -7);
      state.screen = "overview";
      state.selectedWorkoutId = null;
    } else if (action === "next-week") {
      state.weekStart = addDays(state.weekStart, 7);
      state.screen = "overview";
      state.selectedWorkoutId = null;
    } else if (action === "open-workout") {
      state.selectedWorkoutId = workoutId;
      state.screen = "details";
    } else if (action === "back-to-week") {
      state.screen = "overview";
      state.selectedWorkoutId = null;
    } else if (action === "record-workout") {
      const workout = getWorkout(state);
      if (!workout) return;
      ensureSession(state, workout);
      state.screen = "recording";
    } else if (action === "open-details") {
      state.screen = "details";
    } else if (action === "finish-session") {
      const workout = getWorkout(state);
      if (!workout) return;
      ensureSession(state, workout).finished = true;
    }
  }

  const api = {
    createState,
    getWorkouts,
    handleAction,
    render,
    setCompleted,
    setNotes,
    setResult,
    statusFor,
    weekLabel
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ClientWorkoutWorkspace = api;
})(typeof window === "undefined" ? globalThis : window);
