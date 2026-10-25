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

  const localWorkoutTemplates = [
    {
      id: "strength-a",
      weekday: 0,
      name: "Full-body strength A",
      availability: "program",
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
      availability: "program",
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
      availability: "program",
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
      availability: "both",
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
  const localIndependentWorkoutTemplates = [
    {
      id: "mobility-reset",
      name: "Mobility reset",
      availability: "independent",
      type: "Mobility",
      duration: 10,
      status: "available",
      description: "A short movement break to loosen up without pushing intensity.",
      warmup: "",
      cooldown: "",
      exercises: [
        { id: "worlds-greatest-stretch", name: "World’s greatest stretch", sets: 2, reps: 5, weight: null, rest: 20, instruction: "Move through each side slowly and comfortably." },
        { id: "thoracic-rotation", name: "Open-book rotation", sets: 2, reps: 8, weight: null, rest: 20, instruction: "8 gentle repetitions per side." }
      ]
    },
    {
      id: "quick-strength",
      name: "Quick strength",
      availability: "independent",
      type: "Strength",
      duration: 20,
      status: "available",
      description: "A simple, short strength session for a day when you have less time.",
      warmup: "Start with a few easy bodyweight repetitions.",
      cooldown: "",
      exercises: [
        { id: "chair-squat", name: "Chair squat", sets: 3, reps: 10, weight: null, rest: 45, instruction: "Use a chair or bench as a comfortable depth target." },
        { id: "wall-push-up", name: "Wall push-up", sets: 3, reps: 10, weight: null, rest: 45, instruction: "Keep a steady pace and comfortable range." }
      ]
    },
    {
      id: "core-reset",
      name: "Core reset",
      availability: "independent",
      type: "Strength",
      duration: 12,
      status: "available",
      description: "A brief, controlled trunk session with no equipment required.",
      warmup: "",
      cooldown: "",
      exercises: [
        { id: "bird-dog", name: "Bird dog", sets: 2, reps: 8, weight: null, rest: 30, instruction: "8 reps each side; move slowly." },
        { id: "dead-bug-reset", name: "Dead bug", sets: 2, reps: 8, weight: null, rest: 30, instruction: "Keep your lower back comfortable and controlled." }
      ]
    }
  ];
  const unifiedMockData = root.WorkoutPlannerUnifiedMockData;
  const workoutTemplates = unifiedMockData
    ? unifiedMockData.program.schedule.map(entry => {
      const workout = unifiedMockData.workouts.find(item => item.id === entry.workoutId);
      if (!workout) throw new Error(`Unified mock workout "${entry.workoutId}" was not found.`);
      return {
        ...workout,
        weekday: entry.weekday,
        status: entry.status || workout.status
      };
    })
    : localWorkoutTemplates;
  const independentWorkoutTemplates = unifiedMockData
    ? [
      ...unifiedMockData.program.independentWorkoutIds.map(id => {
        const workout = unifiedMockData.workouts.find(item => item.id === id);
        if (!workout) throw new Error(`Unified mock independent workout "${id}" was not found.`);
        return { ...workout, status: "available" };
      }),
      ...localIndependentWorkoutTemplates.filter(workout => workout.id !== "mobility-reset"),
      ...localWorkoutTemplates
        .filter(workout => workout.id === "recovery-mobility")
        .map(workout => ({ ...workout, availability: "independent" }))
    ]
    : localIndependentWorkoutTemplates;

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
    const today = toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
    const todayWeekStart = mondayOf(dateFromISO(today));
    return {
      weekStart: todayWeekStart,
      today,
      todayWeekStart,
      screen: "overview",
      selectedWorkoutId: null,
      selectedWorkoutSnapshot: null,
      selectedWorkoutSource: "planned",
      selectedEntryId: null,
      selectedWorkoutPerformedOn: null,
      sessions: {},
      addedWorkouts: [],
      recordedSessions: [],
      personalWorkouts: [],
      nextPersonalWorkoutId: 1,
      nextEntryId: 1,
      createDraft: null,
      createError: ""
    };
  }

  function getWorkouts(weekStart) {
    return workoutTemplates
      .filter(template => template.availability === "program" || template.availability === "both")
      .map(template => ({
        ...template,
        date: addDays(weekStart, template.weekday),
        exercises: template.exercises.map(exercise => ({ ...exercise }))
      }));
  }

  function getIndependentWorkouts(state) {
    const coachWorkouts = [
      ...independentWorkoutTemplates.filter(template =>
        template.availability === "independent" || template.availability === "both"
      ),
      ...workoutTemplates.filter(template => template.availability === "both")
    ].map(template => ({
      ...template,
      exercises: template.exercises.map(exercise => ({ ...exercise })),
      source: "coach"
    }));
    return coachWorkouts.concat((state.personalWorkouts || []).map(workout => ({
      ...workout,
      exercises: workout.exercises.map(exercise => ({ ...exercise })),
      source: "personal"
    })));
  }

  function sessionKey(state, workout) {
    return [
      state.today,
      state.selectedWorkoutSource || "planned",
      state.selectedEntryId || "",
      workout.id
    ].join(":");
  }

  function getEntriesForDay(state, date) {
    const planned = getWorkouts(mondayOf(dateFromISO(date)))
      .filter(workout => workout.date === date)
      .map(workout => ({
        workout,
        entryType: "planned",
        status: statusFor(state, workout),
        label: null
      }));
    const added = (state.addedWorkouts || []).filter(entry => entry.date === date).map(entry => ({
      workout: entry.workout,
      entryType: "added",
      entryId: entry.id,
      status: "planned",
      label: entry.label || "Extra"
    }));
    const recorded = (state.recordedSessions || [])
      .filter(session => session.performedOn === date
        && !(session.source === "planned" && session.workout.date === date))
      .map(session => ({
      workout: session.workout,
      entryType: "recorded",
      entryId: session.id,
      status: "completed",
      label: session.source === "personal" ? "My workout" : "Extra"
    }));
    return planned.concat(added, recorded);
  }

  function getWorkout(state) {
    if (state.selectedWorkoutSnapshot) return state.selectedWorkoutSnapshot;
    if (!state.selectedWorkoutId) return null;
    const source = state.selectedWorkoutSource || "planned";
    if (source === "planned") {
      return getWorkouts(state.weekStart).find(workout => workout.id === state.selectedWorkoutId) || null;
    }
    if (source === "coach" || source === "personal") {
      return getIndependentWorkouts(state).find(workout => workout.id === state.selectedWorkoutId && workout.source === source) || null;
    }
    if (source === "added") {
      return state.addedWorkouts.find(entry => entry.id === state.selectedEntryId)?.workout || null;
    }
    if (source === "recorded") {
      return state.recordedSessions.find(entry => entry.id === state.selectedEntryId)?.workout || null;
    }
    return null;
  }

  function statusFor(state, workout) {
    const key = `${workout.date}:planned::${workout.id}`;
    const session = state.sessions[key];
    if (session?.finished) return "completed";
    return workout.status === "completed" && workout.date <= state.today ? "completed" : "planned";
  }

  function ensureSession(state, workout) {
    const key = sessionKey(state, workout);
    if (state.sessions[key]) return state.sessions[key];
    const completed = state.selectedWorkoutSource === "planned" && statusFor(state, workout) === "completed";
    const session = {
      finished: completed,
      notes: completed ? "Good energy; kept the final set smooth." : "",
      performedOn: completed ? workout.date : null,
      exercises: {}
    };
    workout.exercises.forEach(exercise => {
      session.exercises[exercise.id] = Array.from({ length: exercise.sets }, () => ({
        reps: exercise.reps ?? "",
        weight: exercise.weight ?? "",
        completed
      }));
    });
    if (state.selectedWorkoutSource === "recorded") {
      const saved = state.recordedSessions.find(entry => entry.id === state.selectedEntryId);
      if (saved) return saved;
    }
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

  function activeWorkout(state) {
    return getWorkout(state);
  }

  function statusBadge(entry) {
    const label = entry.label ? `${entry.label} · ` : "";
    const completed = entry.status === "completed";
    return `<span class="client-workout-status is-${completed ? "completed" : "planned"}${entry.label ? " is-extra" : ""}">${escapeHtml(label)}${completed ? "Completed" : "Planned"}</span>`;
  }

  function updateCreateDraft(state, name, value) {
    if (!state.createDraft) return;
    const exerciseMatch = String(name).match(/^exercise\.(\d+)\.(name|sets|reps|weight|rest|instruction)$/);
    if (exerciseMatch) {
      const exercise = state.createDraft.exercises[Number(exerciseMatch[1])];
      if (exercise) exercise[exerciseMatch[2]] = value;
      return;
    }
    if (["name", "type", "duration", "description"].includes(name)) state.createDraft[name] = value;
  }

  function savePersonalWorkout(state) {
    const draft = state.createDraft;
    if (!draft) return false;
    const name = String(draft.name || "").trim();
    const exercise = draft.exercises?.[0];
    const exerciseName = String(exercise?.name || "").trim();
    if (!name || !exerciseName) {
      state.createError = "Add a workout name and at least one exercise.";
      return false;
    }
    const id = `personal-workout-${state.nextPersonalWorkoutId++}`;
    const workout = {
      id,
      name,
      type: String(draft.type || "Strength"),
      duration: Math.max(1, Number(draft.duration) || 20),
      status: "planned",
      description: String(draft.description || "").trim(),
      source: "personal",
      independent: true,
      exercises: draft.exercises.map((entry, index) => ({
        id: `${id}-exercise-${index + 1}`,
        name: String(entry.name || "").trim(),
        sets: Math.max(1, Number(entry.sets) || 1),
        reps: Math.max(0, Number(entry.reps) || 0),
        weight: entry.weight === "" ? null : Math.max(0, Number(entry.weight) || 0),
        rest: Math.max(0, Number(entry.rest) || 0),
        instruction: String(entry.instruction || "").trim()
      })).filter(entry => entry.name)
    };
    state.personalWorkouts.push(workout);
    state.createDraft = null;
    state.createError = "";
    state.screen = "overview";
    return true;
  }

  function finishSession(state) {
    const workout = getWorkout(state);
    if (!workout) return false;
    const session = ensureSession(state, workout);
    if (session.finished) return false;
    session.finished = true;
    session.performedOn = state.today;
    if (state.selectedWorkoutSource !== "recorded") {
      const source = state.selectedWorkoutSource === "added"
        ? (workout.source === "personal" ? "personal" : "coach")
        : state.selectedWorkoutSource;
      const record = {
        ...JSON.parse(JSON.stringify(session)),
        id: `recorded-session-${state.nextEntryId++}`,
        workout: JSON.parse(JSON.stringify(workout)),
        source,
        performedOn: state.today
      };
      state.recordedSessions.push(record);
    }
    state.sessions[sessionKey(state, workout)] = session;
    return true;
  }

  function createPersonalDraft(state) {
    state.createError = "";
    state.createDraft = {
      name: "",
      type: "Strength",
      duration: "20",
      description: "",
      exercises: [{ name: "", sets: "3", reps: "8", weight: "", rest: "60", instruction: "" }]
    };
    state.screen = "create";
  }

  function addCreateExercise(state) {
    if (!state.createDraft) return;
    if (state.createDraft.exercises.length >= 12) {
      state.createError = "A personal workout can include up to 12 exercises.";
      return;
    }
    state.createDraft.exercises.push({ name: "", sets: "3", reps: "8", weight: "", rest: "60", instruction: "" });
    state.createError = "";
  }

  function removeCreateExercise(state, index) {
    if (!state.createDraft || state.createDraft.exercises.length <= 1) return;
    state.createDraft.exercises.splice(Number(index), 1);
  }

  function renderOverview(state) {
    const cards = weekdays.map(day => {
      const dayDate = addDays(state.weekStart, day.offset);
      const isToday = dayDate === state.today;
      const entries = getEntriesForDay(state, dayDate);
      const entryMarkup = entries.length ? entries.map(entry => {
        const source = entry.entryType;
        const action = source === "recorded" ? "open-session" : "open-workout";
        return `<button class="client-workout-day-item${source === "planned" ? "" : " is-extra"}${entry.status === "completed" ? " is-completed" : ""}" type="button"
          data-workout-action="${action}" data-workout-id="${escapeHtml(entry.workout.id)}"
          data-source="${source}" data-entry-id="${escapeHtml(entry.entryId || "")}"
          aria-label="Open ${escapeHtml(entry.workout.name)}, ${entry.label ? `${escapeHtml(entry.label)}, ` : ""}${entry.status}">
          <span class="client-workout-day-content"><strong>${escapeHtml(entry.workout.name)}</strong><span>${escapeHtml(entry.workout.type)} · ${entry.workout.duration} min · ${entry.workout.exercises.length} ${entry.workout.exercises.length === 1 ? "exercise" : "exercises"}</span></span>
          ${statusBadge(entry)}<span class="client-workout-chevron" aria-hidden="true">›</span>
        </button>`;
      }).join("") : `<div class="client-workout-day-empty"><strong>No workout planned</strong><span>Rest / open day</span></div>`;
      return `<article class="client-workout-day${isToday ? " is-today" : ""}${entries.length ? " has-sessions" : " is-rest"}">
        <div class="client-workout-day-date"><strong>${day.short}</strong><span>${dateLabel(dayDate, { day: "numeric", month: "short" })}</span>${isToday ? `<b class="client-workout-today-pill">Today</b>` : ""}</div>
        <div class="client-workout-day-sessions">${entryMarkup}</div>
      </article>`;
    }).join("");
    const inCurrentWeek = state.weekStart === state.todayWeekStart;
    const hasPlannedToday = getWorkouts(state.todayWeekStart).some(workout => workout.date === state.today);
    const independent = getIndependentWorkouts(state);
    const coachWorkouts = independent.filter(workout => workout.source === "coach");
    const personalWorkouts = independent.filter(workout => workout.source === "personal");
    const availableCards = (items, source) => items.map(workout => `<article class="client-independent-card">
      <div class="client-independent-copy"><strong>${escapeHtml(workout.name)}</strong><span>${escapeHtml(workout.type)} · ${workout.duration} min · ${workout.exercises.length} ${workout.exercises.length === 1 ? "exercise" : "exercises"}</span></div>
      <div class="client-independent-actions">
        <button class="planner-button planner-button-primary planner-button-quiet" type="button" data-workout-action="record-now" data-workout-id="${escapeHtml(workout.id)}" data-source="${source}">Record now</button>
        <button class="planner-button planner-button-quiet" type="button" data-workout-action="add-to-today" data-workout-id="${escapeHtml(workout.id)}" data-source="${source}">Add to today</button>
      </div>
    </article>`).join("");
    const availabilityNote = inCurrentWeek && !hasPlannedToday
      ? `<aside class="client-workout-today-prompt"><strong>No planned workout today</strong><span>Choose an independent session below, or create one for yourself.</span><button class="planner-button planner-button-quiet" type="button" data-workout-action="browse-independent">Browse workouts</button></aside>`
      : "";

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
      ${availabilityNote}
      <details class="client-independent-library" id="client-independent-library" ${state.libraryExpanded ? "open" : ""}>
        <summary><span><strong>Independent workouts</strong><small>Optional sessions, separate from your weekly plan</small></span><b>${independent.length} available</b></summary>
        <div class="client-independent-content">
          <p class="client-independent-intro">Coach-shared workouts stay available whenever you need an extra session.</p>
          <div class="client-independent-list">${availableCards(coachWorkouts, "coach")}</div>
          <section class="client-personal-library"><header><div><strong>My workouts</strong><small>Personal workouts you create for yourself</small></div>
            <button class="planner-button planner-button-quiet" type="button" data-workout-action="create-personal">＋ Create my own</button></header>
            ${personalWorkouts.length ? `<div class="client-independent-list">${availableCards(personalWorkouts, "personal")}</div>` : `<p class="client-personal-empty">No personal workouts yet. Create one to keep it here for later.</p>`}
          </section>
        </div>
      </details>
      <p class="client-workout-footnote">A recorded session saves your actual results in this preview. It does not change the prescribed workout.</p>
    </section>`;
  }

  function renderDetails(state, workout) {
    const planned = state.selectedWorkoutSource === "planned";
    const status = planned
      ? statusFor(state, workout)
      : state.selectedWorkoutSource === "recorded"
        ? "completed"
        : "planned";
    const sourceLabel = planned
      ? dateLabel(workout.date, { weekday: "long", day: "numeric", month: "long" })
      : state.selectedWorkoutSource === "personal"
        ? "Your personal workout"
        : state.selectedWorkoutSource === "recorded"
          ? `Recorded ${dateLabel(state.selectedWorkoutPerformedOn || state.today, { weekday: "long", day: "numeric", month: "long" })}`
          : state.selectedWorkoutSource === "added"
            ? "Added to today"
          : "Independent workout · Available anytime";
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
      <button class="planner-button client-workout-back-button" type="button" data-workout-action="back-to-week"><span aria-hidden="true">←</span> Back to Workouts</button>
      <header class="client-workout-detail-head">
        <div><p class="planner-eyebrow">${escapeHtml(workout.type)} · ${escapeHtml(sourceLabel)}</p>
          <h1>${escapeHtml(workout.name)}</h1><p class="planner-lede">${escapeHtml(workout.description)}</p></div>
        <span class="client-workout-status is-${status === "completed" ? "completed" : "planned"}">${status === "completed" ? "Completed" : planned ? "Planned" : "Independent"}</span>
      </header>
      <div class="client-workout-detail-meta"><span>◷ ${workout.duration} min</span><span>${workout.exercises.length} exercises</span></div>
      ${workout.warmup ? `<section class="client-workout-note-card"><strong>Warm-up</strong><p>${escapeHtml(workout.warmup)}</p></section>` : ""}
      <section class="client-workout-detail-card"><header><div><h2>Exercise plan</h2><p>Prescribed sets, repetitions and rest periods.</p></div></header><div class="client-workout-exercise-list">${exercises}</div></section>
      ${workout.cooldown ? `<section class="client-workout-note-card"><strong>Cool-down</strong><p>${escapeHtml(workout.cooldown)}</p></section>` : ""}
      <div class="client-workout-detail-actions">
        <button class="planner-button planner-button-primary" type="button" data-workout-action="${state.selectedWorkoutSource === "recorded" || status === "completed" ? "view-recorded-session" : "record-workout"}">${state.selectedWorkoutSource === "recorded" || status === "completed" ? "View recorded session" : "Record workout"}</button>
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
      ? `<div class="client-workout-complete-banner" role="status"><strong>Session recorded for ${dateLabel(session.performedOn || workout.date || state.today, { weekday: "long", day: "numeric", month: "long" })}</strong><span>Your actual results are saved in this preview. The prescribed workout was not changed.</span></div>`
      : "";
    const performedOn = session.finished
      ? session.performedOn || workout.date || state.today
      : state.today;

    return `<section class="client-workouts">
      <button class="planner-button client-workout-back-button" type="button" data-workout-action="back-to-week"><span aria-hidden="true">←</span> Back to Workouts</button>
      <header class="client-workout-detail-head">
        <div><p class="planner-eyebrow">${session.finished ? "COMPLETED SESSION" : "RECORDING SESSION"} · ${dateLabel(performedOn, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1>${escapeHtml(workout.name)}</h1><p class="planner-lede">Log what you actually performed. Your prescribed workout stays as written.</p></div>
      </header>
      ${completedBanner}
      <section class="client-workout-record-card">
        ${exerciseCards}
        <label class="client-workout-notes"><span>Session notes</span><textarea data-workout-notes placeholder="How did the session feel?" ${session.finished ? "disabled" : ""}>${escapeHtml(session.notes)}</textarea></label>
        ${session.finished
          ? `<button class="planner-button" type="button" data-workout-action="back-to-week">Back to Workouts</button>`
          : `<button class="planner-button planner-button-primary" type="button" data-workout-action="finish-session">Finish session</button>`}
      </section>
    </section>`;
  }

  function renderCreate(state) {
    const draft = state.createDraft;
    const exercises = draft.exercises.map((exercise, index) => `<section class="client-workout-create-exercise">
      <header><strong>Exercise ${index + 1}</strong>${draft.exercises.length > 1 ? `<button class="client-workout-remove-exercise" type="button" data-workout-action="remove-create-exercise" data-exercise-index="${index}">Remove</button>` : ""}</header>
      <div class="client-workout-create-grid">
        <label class="planner-field">Exercise name<input name="exercise.${index}.name" required maxlength="100" value="${escapeHtml(exercise.name)}"></label>
        <label class="planner-field">Sets<input name="exercise.${index}.sets" type="number" min="1" max="30" step="1" value="${escapeHtml(exercise.sets)}"></label>
        <label class="planner-field">Reps / duration<input name="exercise.${index}.reps" type="number" min="0" max="999" step="any" value="${escapeHtml(exercise.reps)}"></label>
        <label class="planner-field">Weight · kg<input name="exercise.${index}.weight" type="number" min="0" step="any" value="${escapeHtml(exercise.weight)}" placeholder="Optional"></label>
        <label class="planner-field">Rest · seconds<input name="exercise.${index}.rest" type="number" min="0" step="1" value="${escapeHtml(exercise.rest)}"></label>
        <label class="planner-field wide">Instructions<input name="exercise.${index}.instruction" maxlength="300" value="${escapeHtml(exercise.instruction)}" placeholder="Optional"></label>
      </div>
    </section>`).join("");
    return `<section class="client-workouts">
      <button class="planner-button client-workout-back-button" type="button" data-workout-action="cancel-create"><span aria-hidden="true">←</span> Back to Workouts</button>
      <header class="client-workout-detail-head"><div><p class="planner-eyebrow">PERSONAL · AVAILABLE WHENEVER YOU WANT</p>
        <h1>Create my own workout</h1><p class="planner-lede">This personal workout is separate from your coach’s plan and is only kept in this preview.</p></div></header>
      <form class="client-workout-create-form" data-client-workout-create>
        <div class="client-workout-create-grid">
          <label class="planner-field">Workout name<input name="name" required maxlength="100" value="${escapeHtml(draft.name)}"></label>
          <label class="planner-field">Type<select name="type">${["Strength", "Cardio", "Mobility", "Mixed"].map(type => `<option value="${type}" ${draft.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
          <label class="planner-field">Approx. duration · minutes<input name="duration" type="number" min="1" max="240" value="${escapeHtml(draft.duration)}"></label>
          <label class="planner-field wide">Focus / notes<textarea name="description" maxlength="500">${escapeHtml(draft.description)}</textarea></label>
        </div>
        <div class="client-workout-create-exercises"><header><div><h2>Exercises</h2><p>Add the movements and a simple prescription.</p></div>
          <button class="planner-button planner-button-quiet" type="button" data-workout-action="add-create-exercise">＋ Add exercise</button></header>${exercises}</div>
        <p class="client-workout-create-error" role="alert">${escapeHtml(state.createError)}</p>
        <div class="client-workout-create-actions"><button class="planner-button" type="button" data-workout-action="cancel-create">Cancel</button><button class="planner-button planner-button-primary" type="submit">Save personal workout</button></div>
      </form>
    </section>`;
  }

  function render(state) {
    if (state.screen === "create" && state.createDraft) return renderCreate(state);
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

  function workoutForSource(state, workoutId, source, entryId) {
    if (source === "planned") return getWorkouts(state.weekStart).find(workout => workout.id === workoutId) || null;
    if (source === "coach" || source === "personal") {
      return getIndependentWorkouts(state).find(workout => workout.id === workoutId && workout.source === source) || null;
    }
    if (source === "added") return state.addedWorkouts.find(entry => entry.id === entryId)?.workout || null;
    if (source === "recorded") return state.recordedSessions.find(entry => entry.id === entryId)?.workout || null;
    return null;
  }

  function selectWorkout(state, workoutId, source = "planned", entryId = null) {
    state.selectedWorkoutId = workoutId;
    state.selectedWorkoutSource = source || "planned";
    state.selectedEntryId = entryId || null;
    const workout = workoutForSource(state, workoutId, state.selectedWorkoutSource, state.selectedEntryId);
    state.selectedWorkoutSnapshot = workout ? JSON.parse(JSON.stringify(workout)) : null;
    const recordedSession = state.selectedWorkoutSource === "recorded"
      ? state.recordedSessions.find(entry => entry.id === state.selectedEntryId)
      : null;
    state.selectedWorkoutPerformedOn = recordedSession?.performedOn || null;
    return workout;
  }

  function clearSelection(state) {
    state.selectedWorkoutId = null;
    state.selectedWorkoutSnapshot = null;
    state.selectedWorkoutSource = "planned";
    state.selectedEntryId = null;
    state.selectedWorkoutPerformedOn = null;
  }

  function handleAction(state, action, workoutId, source, entryId) {
    if (action === "previous-week") {
      state.weekStart = addDays(state.weekStart, -7);
      state.screen = "overview";
      clearSelection(state);
    } else if (action === "next-week") {
      state.weekStart = addDays(state.weekStart, 7);
      state.screen = "overview";
      clearSelection(state);
    } else if (action === "open-workout") {
      if (selectWorkout(state, workoutId, source || "planned", entryId)) state.screen = "details";
    } else if (action === "open-session") {
      if (selectWorkout(state, workoutId, "recorded", entryId)) state.screen = "recording";
    } else if (action === "back-to-week") {
      state.screen = "overview";
      clearSelection(state);
    } else if (action === "record-workout" || action === "view-recorded-session") {
      const workout = getWorkout(state);
      if (!workout) return;
      ensureSession(state, workout);
      state.screen = "recording";
    } else if (action === "record-now") {
      const workout = selectWorkout(state, workoutId, source || "coach");
      if (!workout) return;
      ensureSession(state, workout);
      state.selectedWorkoutPerformedOn = state.today;
      state.screen = "recording";
    } else if (action === "add-to-today") {
      const workout = workoutForSource(state, workoutId, source || "coach");
      if (!workout) return;
      const alreadyAdded = state.addedWorkouts.some(entry =>
        entry.date === state.today && entry.workout.id === workout.id && entry.source === source
      );
      if (!alreadyAdded) {
        state.addedWorkouts.push({
          id: `added-workout-${state.nextEntryId++}`,
          date: state.today,
          source: source || "coach",
          label: source === "personal" ? "My workout" : "Extra",
          workout: JSON.parse(JSON.stringify(workout))
        });
      }
      state.weekStart = state.todayWeekStart;
      state.libraryExpanded = true;
      state.screen = "overview";
      clearSelection(state);
    } else if (action === "browse-independent") {
      state.libraryExpanded = true;
    } else if (action === "create-personal") {
      createPersonalDraft(state);
    } else if (action === "add-create-exercise") {
      addCreateExercise(state);
    } else if (action === "remove-create-exercise") {
      removeCreateExercise(state, entryId);
    } else if (action === "cancel-create") {
      state.createDraft = null;
      state.createError = "";
      state.screen = "overview";
    } else if (action === "finish-session") {
      finishSession(state);
    }
  }

  const api = {
    createState,
    activeWorkout,
    addCreateExercise,
    finishSession,
    getWorkouts,
    getIndependentWorkouts,
    handleAction,
    render,
    savePersonalWorkout,
    setCompleted,
    setNotes,
    setResult,
    statusFor,
    updateCreateDraft,
    weekLabel
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ClientWorkoutWorkspace = api;
})(typeof window === "undefined" ? globalThis : window);
