const TrackerData = (() => {
  const STORAGE_KEY = "halsopulsen.personal-tracker.v2";
  const LEGACY_STORAGE_KEY = "halsopulsen.personal-tracker.v1";
  const OWNER_KEY_STORAGE_KEY = "halsopulsen.owner-key.v1";
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function todayISO() {
    return toISO(new Date());
  }

  function toISO(date) {
    const value = new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  function fromISO(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function addDays(value, amount) {
    const date = typeof value === "string" ? fromISO(value) : new Date(value);
    date.setDate(date.getDate() + amount);
    return toISO(date);
  }

  function startOfWeek(value) {
    const date = typeof value === "string" ? fromISO(value) : new Date(value);
    date.setDate(date.getDate() - date.getDay());
    return toISO(date);
  }

  function daysBetween(start, end) {
    return Math.round((fromISO(end) - fromISO(start)) / 86400000);
  }

  function formatLongDate(value) {
    const date = fromISO(value);
    return `${DAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  }

  function formatShortDate(value) {
    const date = fromISO(value);
    return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
  }

  function formatDateRange(start, end) {
    const a = fromISO(start);
    const b = fromISO(end);
    if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTH_NAMES[a.getMonth()]}`;
    return `${a.getDate()} ${MONTH_NAMES[a.getMonth()]}–${b.getDate()} ${MONTH_NAMES[b.getMonth()]}`;
  }

  function formatRest(seconds) {
    if (!seconds) return "flexible";
    if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
    return `${seconds} sec`;
  }

  function formatNumber(value) {
    return Number.isInteger(Number(value)) ? String(Number(value)) : Number(value).toFixed(1).replace(/\.0$/, "");
  }

  function targetLabel(exercise) {
    const value = formatNumber(exercise?.targetValue ?? exercise?.reps ?? 0);
    const unit = exercise?.targetUnit || exercise?.unit || "reps";
    return `${value} ${unit}`;
  }

  function intensityLabel(exercise) {
    return exercise?.intensity ? ` · ${exercise.intensity}` : "";
  }

  function emptyDay(weekday) {
    return { weekday, enabled: false, name: "", description: "", exercises: [] };
  }

  function defaultProgram() {
    return {
      name: "Foundation week",
      description: "A balanced week with clear sessions and room to move them.",
      version: 1,
      days: [
        { weekday: 0, enabled: true, name: "Easy recovery", description: "Keep this relaxed and leave fresh.", exercises: [{ name: "Brisk walk", activityType: "exercise", sets: 1, targetValue: 30, targetUnit: "minutes", restSeconds: 0 }] },
        { weekday: 1, enabled: true, name: "Strength A", description: "Smooth, controlled repetitions.", exercises: [{ name: "Bodyweight squats", activityType: "exercise", sets: 3, targetValue: 12, targetUnit: "reps", restSeconds: 120 }, { name: "Incline push-ups", activityType: "exercise", sets: 3, targetValue: 8, targetUnit: "reps", restSeconds: 90 }] },
        emptyDay(2),
        { weekday: 3, enabled: true, name: "Mobility", description: "Move through a comfortable range.", exercises: [{ name: "Hip mobility flow", activityType: "exercise", sets: 2, targetValue: 8, targetUnit: "reps", restSeconds: 60 }, { name: "Dead hang", activityType: "exercise", sets: 3, targetValue: 20, targetUnit: "seconds", restSeconds: 90 }] },
        emptyDay(4),
        { weekday: 5, enabled: true, name: "Strength B", description: "Keep one or two good repetitions in reserve.", exercises: [{ name: "Reverse lunges", activityType: "exercise", sets: 3, targetValue: 8, targetUnit: "reps", restSeconds: 120 }, { name: "Backpack rows", activityType: "exercise", sets: 3, targetValue: 10, targetUnit: "reps", restSeconds: 90 }] },
        emptyDay(6)
      ]
    };
  }

  function normalizeExercise(exercise) {
    const activityType = exercise?.activityType || (exercise?.unit === "km" || exercise?.distanceKm != null ? "run" : "exercise");
    const targetUnit = exercise?.targetUnit
      || (activityType === "run" ? "km" : exercise?.unit || "reps");
    const legacyTarget = exercise?.targetValue ?? (targetUnit === "km" ? exercise?.distanceKm : exercise?.reps);
    return {
      name: String(exercise?.name || "Exercise"),
      activityType,
      sets: activityType === "run" ? 1 : Math.max(1, Number(exercise?.sets) || 1),
      targetValue: Math.max(0.1, Number(legacyTarget) || 1),
      targetUnit,
      intensity: String(exercise?.intensity || ""),
      reps: Math.max(1, Number(exercise?.reps) || 1),
      restSeconds: Math.max(0, Number(exercise?.restSeconds) || 0),
      unit: targetUnit
    };
  }

  function normalizeWorkout(workout, weekday = 0) {
    const exercises = Array.isArray(workout?.exercises) ? workout.exercises.map(normalizeExercise) : [];
    return {
      weekday,
      enabled: workout?.enabled !== false && exercises.length > 0,
      name: String(workout?.name || (exercises[0]?.name || "Workout")),
      description: String(workout?.description || ""),
      exercises
    };
  }

  function normalizeProgram(program) {
    const sourceDays = Array.isArray(program?.days) ? program.days : [];
    const days = Array.from({ length: 7 }, (_, weekday) => {
      const source = sourceDays.find(day => Number(day.weekday) === weekday);
      return source ? normalizeWorkout({ ...source, enabled: source.enabled !== false }, weekday) : emptyDay(weekday);
    });
    return {
      name: String(program?.name || "Training plan"),
      description: String(program?.description || ""),
      version: Number(program?.version) || 1,
      days
    };
  }

  function oldProgramToNew(rawProgram) {
    const old = rawProgram || {};
    const exercises = Array.isArray(old.exercises) ? old.exercises.map(normalizeExercise) : [];
    const recommendedDays = Array.isArray(old.recommendedDays) ? old.recommendedDays.map(Number) : [];
    return normalizeProgram({
      name: old.name || "Training plan",
      description: old.description || "",
      version: old.version || 1,
      days: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        enabled: recommendedDays.includes(weekday),
        name: old.name || "Workout",
        description: old.description || "",
        exercises
      }))
    });
  }

  function migrate(raw) {
    if (raw?.draftProgram) {
      const draftProgram = normalizeProgram(raw.draftProgram);
      const draftGoal = String(raw.draftGoal || raw.goal || "Build a consistent training habit");
      return {
        schemaVersion: 2,
        person: raw.person || { name: "My dashboard" },
        goal: String(raw.publishedGoal || raw.goal || draftGoal),
        draftGoal,
        publishedGoal: String(raw.publishedGoal || raw.goal || draftGoal),
        draftProgram,
        publishedProgram: raw.publishedProgram ? normalizeProgram(raw.publishedProgram) : clone(draftProgram),
        publishedPlanId: raw.publishedPlanId || null,
        publishedSharePath: raw.publishedSharePath || "",
        publishedPlans: Array.isArray(raw.publishedPlans) ? raw.publishedPlans : [],
        assignments: (raw.assignments || []).map(normalizeAssignment),
        logs: Array.isArray(raw.logs) ? raw.logs : []
      };
    }

    const draftProgram = oldProgramToNew(raw?.program);
    const goal = String(raw?.goal || "Build a consistent training habit");
    return {
      schemaVersion: 2,
      person: raw?.person || { name: "My dashboard" },
      goal,
      draftGoal: goal,
      publishedGoal: goal,
      draftProgram,
      publishedProgram: clone(draftProgram),
      publishedPlanId: null,
      publishedSharePath: "",
      publishedPlans: [],
      assignments: (raw?.assignments || []).map(normalizeAssignment),
      logs: Array.isArray(raw?.logs) ? raw.logs : []
    };
  }

  function normalizeAssignment(assignment) {
    const fallbackWorkout = {
      name: assignment?.exercises?.[0]?.name || "Training session",
      description: "",
      exercises: assignment?.exercises || []
    };
    const workout = normalizeWorkout(assignment?.workout || fallbackWorkout);
    return {
      id: String(assignment?.id || `assignment-${assignment?.recommendedDate || assignment?.date || Date.now()}`),
      date: String(assignment?.date || assignment?.recommendedDate || todayISO()),
      recommendedDate: String(assignment?.recommendedDate || assignment?.date || todayISO()),
      status: assignment?.status || "planned",
      moved: Boolean(assignment?.moved),
      workout
    };
  }

  function defaultData() {
    const program = defaultProgram();
    const normalizedProgram = normalizeProgram(program);
    return {
      schemaVersion: 2,
      person: { name: "My dashboard" },
      goal: "Build a consistent training habit",
      draftGoal: "Build a consistent training habit",
      publishedGoal: "Build a consistent training habit",
      draftProgram: clone(normalizedProgram),
      publishedProgram: clone(normalizedProgram),
      publishedPlanId: null,
      publishedSharePath: "",
      publishedPlans: [],
      assignments: [],
      logs: []
    };
  }

  function load(storageKey = STORAGE_KEY) {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey))
        || (storageKey === STORAGE_KEY
          ? JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY))
          : null);
      return stored ? migrate(stored) : defaultData();
    } catch (error) {
      console.warn("Could not load tracker data", error);
      return defaultData();
    }
  }

  function save(data, storageKey = STORAGE_KEY) {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }

  function getOwnerKey() {
    let ownerKey = localStorage.getItem(OWNER_KEY_STORAGE_KEY);
    if (!ownerKey) {
      ownerKey = window.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(OWNER_KEY_STORAGE_KEY, ownerKey);
    }
    return ownerKey;
  }

  function fromPublishedPlan(plan) {
    const program = normalizeProgram(plan?.program);
    const goal = String(plan?.goal || "Build a consistent training habit");
    return {
      schemaVersion: 2,
      person: { name: String(plan?.personName || "Shared plan") },
      goal,
      draftGoal: goal,
      publishedGoal: goal,
      draftProgram: clone(program),
      publishedProgram: clone(program),
      publishedPlanId: plan?.id || null,
      publishedSharePath: "",
      publishedPlans: [],
      assignments: Array.isArray(plan?.assignments) ? plan.assignments.map(normalizeAssignment) : [],
      logs: Array.isArray(plan?.logs) ? plan.logs : []
    };
  }

  function assignmentForDate(data, date) {
    return data.assignments.find(assignment => assignment.date === date) || null;
  }

  function logForAssignment(data, id) {
    return data.logs.find(log => log.assignmentId === id) || null;
  }

  function ensureAssignments(data) {
    const program = data.publishedProgram;
    if (!program) return;
    const start = addDays(todayISO(), -35);
    const end = addDays(todayISO(), 56);
    const existingDates = new Set(data.assignments.map(assignment => assignment.date));
    for (let index = 0; index <= daysBetween(start, end); index += 1) {
      const date = addDays(start, index);
      const weekday = fromISO(date).getDay();
      const workout = program.days.find(day => day.weekday === weekday);
      if (!workout?.enabled || !workout.exercises.length || existingDates.has(date)) continue;
      data.assignments.push({
        id: `assignment-${date}`,
        date,
        recommendedDate: date,
        status: "planned",
        moved: false,
        workout: clone(workout)
      });
      existingDates.add(date);
    }
    data.assignments.sort((a, b) => a.date.localeCompare(b.date));
  }

  function hasDraftChanges(data) {
    if (!data.publishedProgram || !data.publishedPlanId) return true;
    return data.draftGoal !== data.publishedGoal
      || JSON.stringify(data.draftProgram) !== JSON.stringify(data.publishedProgram);
  }

  return {
    STORAGE_KEY,
    OWNER_KEY_STORAGE_KEY,
    DAY_NAMES,
    WEEKDAYS,
    clone,
    todayISO,
    toISO,
    fromISO,
    addDays,
    startOfWeek,
    daysBetween,
    formatLongDate,
    formatShortDate,
    formatDateRange,
    formatRest,
    targetLabel,
    intensityLabel,
    emptyDay,
    defaultProgram,
    normalizeExercise,
    normalizeProgram,
    load,
    save,
    getOwnerKey,
    fromPublishedPlan,
    assignmentForDate,
    logForAssignment,
    ensureAssignments,
    hasDraftChanges
  };
})();