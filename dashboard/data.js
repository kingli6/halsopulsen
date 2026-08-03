const TrackerData = (() => {
  const STORAGE_KEY = "halsopulsen.personal-tracker.v2";
  const LEGACY_STORAGE_KEY = "halsopulsen.personal-tracker.v1";
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

  function emptyDay(weekday) {
    return {
      weekday,
      enabled: false,
      name: "",
      description: "",
      sessionType: "Rest / open day",
      warmup: "",
      cooldown: "",
      exercises: []
    };
  }

  function defaultProgram() {
    return {
      name: "Foundation week",
      description: "A balanced week with clear sessions and room to move them.",
      version: 1,
      phase: "Foundation",
      weekNumber: 1,
      durationWeeks: 4,
      startDate: todayISO(),
      progressionNotes: "Build consistency first. Add load or volume only when the current week feels repeatable.",
      successMetric: "Complete the planned sessions with good technique.",
      days: [
        { weekday: 0, enabled: true, name: "Easy recovery", description: "Keep this relaxed and leave fresh.", sessionType: "Cardio", exercises: [{ name: "Brisk walk", activityType: "cardio", format: "continuous", targetValue: 30, targetUnit: "minutes", intensity: "Easy", goal: "Keep the pace conversational.", restSeconds: 0 }] },
        { weekday: 1, enabled: true, name: "Strength A", description: "Smooth, controlled repetitions.", sessionType: "Strength", exercises: [{ name: "Bodyweight squats", activityType: "strength", sets: 3, targetValue: 12, targetUnit: "reps", rir: 2, restSeconds: 120 }, { name: "Incline push-ups", activityType: "strength", sets: 3, targetValue: 8, targetUnit: "reps", rir: 2, restSeconds: 90 }] },
        emptyDay(2),
        { weekday: 3, enabled: true, name: "Mobility", description: "Move through a comfortable range.", sessionType: "Mobility / recovery", exercises: [{ name: "Hip mobility flow", activityType: "guided", format: "guided", durationMinutes: 12, targetValue: 12, targetUnit: "minutes", goal: "Move gently through a comfortable range.", restSeconds: 0 }, { name: "Dead hang", activityType: "strength", sets: 3, targetValue: 20, targetUnit: "seconds", restSeconds: 90 }] },
        emptyDay(4),
        { weekday: 5, enabled: true, name: "Strength B", description: "Keep one or two good repetitions in reserve.", sessionType: "Strength", exercises: [{ name: "Reverse lunges", activityType: "strength", sets: 3, targetValue: 8, targetUnit: "reps", rir: 2, restSeconds: 120 }, { name: "Backpack rows", activityType: "strength", sets: 3, targetValue: 10, targetUnit: "reps", rir: 2, restSeconds: 90 }] },
        emptyDay(6)
      ]
    };
  }

  function inferActivityType(exercise) {
    const rawType = String(exercise?.activityType || "").toLowerCase();
    if (rawType === "run" || rawType === "cardio") return "cardio";
    if (rawType === "guided") return "guided";
    if (rawType === "strength") return "strength";
    const name = String(exercise?.name || "").toLowerCase();
    if (exercise?.unit === "km" || exercise?.distanceKm != null || /run|walk|jog|bike|cycle|row|swim|hike|ellipt|cardio/.test(name)) return "cardio";
    if (/mobility|yoga|soma|zumba|dance|stretch|flow|video|class|breath/.test(name)) return "guided";
    return "strength";
  }

  function normalizeExercise(exercise) {
    const activityType = inferActivityType(exercise);
    const legacyIntervals = String(exercise?.intensity || "").toLowerCase() === "intervals";
    const format = String(exercise?.format || (legacyIntervals ? "intervals" : activityType === "guided" ? "guided" : activityType === "cardio" ? "continuous" : "sets"));
    const targetUnit = exercise?.targetUnit
      || (activityType === "cardio" && !legacyIntervals ? (exercise?.unit || "km") : activityType === "guided" ? "minutes" : "reps");
    const legacyTarget = exercise?.targetValue
      ?? (activityType === "guided" ? exercise?.durationMinutes : null)
      ?? (targetUnit === "km" ? exercise?.distanceKm : exercise?.reps);
    const durationMinutes = Number(exercise?.durationMinutes ?? (activityType === "guided" || (activityType === "cardio" && targetUnit === "minutes" && !legacyIntervals) ? legacyTarget : 0)) || null;
    const rounds = Number(exercise?.rounds ?? (format === "intervals" ? legacyTarget : 0)) || null;
    return {
      name: String(exercise?.name || "Exercise"),
      activityType,
      format,
      description: String(exercise?.description || ""),
      goal: String(exercise?.goal || ""),
      sets: activityType === "strength" ? Math.max(1, Number(exercise?.sets) || 1) : 1,
      targetValue: Math.max(0.1, Number(format === "intervals" ? rounds : legacyTarget) || 1),
      targetUnit: format === "intervals" ? "rounds" : targetUnit,
      durationMinutes,
      rounds,
      workDurationSeconds: Number(exercise?.workDurationSeconds) > 0 ? Number(exercise.workDurationSeconds) : null,
      recoveryDurationSeconds: Number(exercise?.recoveryDurationSeconds) > 0 ? Number(exercise.recoveryDurationSeconds) : null,
      intensity: legacyIntervals ? "" : String(exercise?.intensity || ""),
      heartRateTarget: String(exercise?.heartRateTarget || ""),
      rir: Number.isFinite(Number(exercise?.rir)) && exercise?.rir !== "" ? Math.max(0, Math.min(5, Number(exercise.rir))) : null,
      load: Number(exercise?.load) > 0 ? Number(exercise.load) : null,
      loadUnit: exercise?.loadUnit === "lb" ? "lb" : "kg",
      tempo: String(exercise?.tempo || ""),
      notes: String(exercise?.notes || ""),
      resourceUrl: String(exercise?.resourceUrl || ""),
      reps: Math.max(1, Number(exercise?.reps) || 1),
      restSeconds: Math.max(0, Number(exercise?.restSeconds) || 0),
      unit: format === "intervals" ? "rounds" : targetUnit
    };
  }

  function normalizeWorkout(workout, weekday = 0) {
    const exercises = Array.isArray(workout?.exercises) ? workout.exercises.map(normalizeExercise) : [];
    const sessionTypeMap = {
      Run: "Cardio",
      Recovery: "Mobility / recovery",
      Mobility: "Mobility / recovery",
      Conditioning: "Cardio",
      Skill: "Guided session",
      Training: "Other"
    };
    const rawSessionType = String(workout?.sessionType || "Other");
    return {
      weekday,
      enabled: workout?.enabled !== false && exercises.length > 0,
      name: String(workout?.name || (exercises[0]?.name || "Workout")),
      description: String(workout?.description || ""),
      sessionType: sessionTypeMap[rawSessionType] || rawSessionType,
      warmup: String(workout?.warmup || ""),
      cooldown: String(workout?.cooldown || ""),
      exercises
    };
  }

  function normalizeWeek(week, fallbackWeekNumber = 1, programDefaults = {}) {
    const sourceDays = Array.isArray(week?.days) ? week.days : [];
    const days = Array.from({ length: 7 }, (_, weekday) => {
      const source = sourceDays.find(day => Number(day.weekday) === weekday);
      return source ? normalizeWorkout({ ...source, enabled: source.enabled !== false }, weekday) : emptyDay(weekday);
    });
    return {
      weekNumber: Math.max(1, Number(week?.weekNumber) || fallbackWeekNumber),
      phase: String(week?.phase || programDefaults.phase || "Foundation"),
      progressionNotes: String(week?.progressionNotes || programDefaults.progressionNotes || ""),
      successMetric: String(week?.successMetric || programDefaults.successMetric || ""),
      days
    };
  }

  function syncProgramSummary(program) {
    const firstWeek = program.weeks?.[0] || normalizeWeek({ days: program.days }, 1, program);
    program.weeks = Array.isArray(program.weeks) && program.weeks.length ? program.weeks : [firstWeek];
    program.durationWeeks = program.weeks.length;
    program.days = program.weeks[0].days;
    program.phase = program.weeks[0].phase;
    program.weekNumber = program.weeks[0].weekNumber;
    program.progressionNotes = program.weeks[0].progressionNotes;
    program.successMetric = program.weeks[0].successMetric;
    return program;
  }

  function normalizeProgram(program) {
    const programDefaults = {
      phase: String(program?.phase || "Foundation"),
      progressionNotes: String(program?.progressionNotes || ""),
      successMetric: String(program?.successMetric || "")
    };
    const sourceWeeks = Array.isArray(program?.weeks) && program.weeks.length
      ? program.weeks
      : Array.from({ length: Math.max(1, Number(program?.durationWeeks) || 1) }, (_, index) => ({
        weekNumber: (Number(program?.weekNumber) || 1) + index,
        days: Array.isArray(program?.days) ? program.days : [],
        phase: programDefaults.phase,
        progressionNotes: programDefaults.progressionNotes,
        successMetric: programDefaults.successMetric
      }));
    const weeks = sourceWeeks.map((week, index) => normalizeWeek(week, index + 1, programDefaults));
    return syncProgramSummary({
      name: String(program?.name || "Training plan"),
      description: String(program?.description || ""),
      version: Number(program?.version) || 1,
      phase: programDefaults.phase,
      weekNumber: Math.max(1, Number(program?.weekNumber) || 1),
      durationWeeks: weeks.length,
      startDate: String(program?.startDate || todayISO()),
      progressionNotes: programDefaults.progressionNotes,
      successMetric: programDefaults.successMetric,
      weeks
    });
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
        history: normalizeHistory(raw.history),
        draftSourcePlanId: raw.draftSourcePlanId || null,
        draftSourceVersion: Number(raw.draftSourceVersion) || null,
        publishedAt: raw.publishedAt || "",
        assignmentPrefix: String(raw.assignmentPrefix || ""),
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
      history: [],
      draftSourcePlanId: null,
      draftSourceVersion: null,
      publishedAt: "",
      assignmentPrefix: "",
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
      weekNumber: Number(assignment?.weekNumber) || null,
      workout
    };
  }

  function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history.map(item => ({
      planId: String(item?.planId || ""),
      version: Number(item?.version) || 1,
      name: String(item?.name || "Previous plan"),
      publishedAt: String(item?.publishedAt || ""),
      program: item?.program ? normalizeProgram(item.program) : null,
      assignments: Array.isArray(item?.assignments) ? item.assignments.map(normalizeAssignment) : [],
      logs: Array.isArray(item?.logs) ? item.logs : []
    })).filter(item => item.planId || item.assignments.length || item.logs.length);
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
      history: [],
      draftSourcePlanId: null,
      draftSourceVersion: null,
      publishedAt: "",
      assignmentPrefix: "",
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
      history: normalizeHistory(plan?.history),
      draftSourcePlanId: null,
      draftSourceVersion: Number(plan?.version) || null,
      publishedAt: plan?.publishedAt || "",
      assignmentPrefix: `v${Number(plan?.version) || 1}-assignment`,
      assignments: Array.isArray(plan?.assignments) ? plan.assignments.map(normalizeAssignment) : [],
      logs: Array.isArray(plan?.logs) ? plan.logs : []
    };
  }

  function assignmentForDate(data, date) {
    return data.assignments.find(assignment => assignment.date === date) || null;
  }

  function allAssignments(data) {
    return [
      ...(Array.isArray(data?.history) ? data.history.flatMap(item => item.assignments || []) : []),
      ...(data?.assignments || [])
    ];
  }

  function allLogs(data) {
    return [
      ...(Array.isArray(data?.history) ? data.history.flatMap(item => item.logs || []) : []),
      ...(data?.logs || [])
    ];
  }

  function assignmentForId(data, id) {
    return allAssignments(data).find(assignment => assignment.id === id) || null;
  }

  function logForAssignment(data, id) {
    return allLogs(data).find(log => log.assignmentId === id) || null;
  }

  function logsForDate(data, date) {
    return allLogs(data).filter(log => log.date === date);
  }

  function isStandaloneLog(log) {
    return !log?.assignmentId || log.source === "other";
  }

  function standaloneLogsForDate(data, date) {
    return logsForDate(data, date).filter(isStandaloneLog);
  }

  function programWeekIndexForDate(program, date) {
    const weeks = Array.isArray(program?.weeks) && program.weeks.length ? program.weeks : [program];
    const start = startOfWeek(program?.startDate || todayISO());
    const offset = Math.floor(daysBetween(start, date) / 7);
    return Math.max(0, Math.min(weeks.length - 1, offset));
  }

  function programWeekForDate(program, date) {
    const weeks = Array.isArray(program?.weeks) && program.weeks.length ? program.weeks : [program];
    return weeks[programWeekIndexForDate(program, date)] || weeks[0] || null;
  }

  function ensureAssignments(data, options = {}) {
    const program = data.publishedProgram;
    if (!program) return;
    const weeks = Array.isArray(program.weeks) && program.weeks.length ? program.weeks : [program];
    const start = options.startDate || startOfWeek(program.startDate || todayISO());
    const end = options.endDate || addDays(start, weeks.length * 7 - 1);
    const existingDates = new Set(data.assignments.map(assignment => assignment.date));
    for (let index = 0; index <= daysBetween(start, end); index += 1) {
      const date = addDays(start, index);
      const weekday = fromISO(date).getDay();
      const weekIndex = programWeekIndexForDate(program, date);
      const week = weeks[weekIndex];
      const workout = week?.days.find(day => day.weekday === weekday);
      if (!workout?.enabled || !workout.exercises.length || existingDates.has(date)) continue;
      data.assignments.push({
        id: `${data.assignmentPrefix || "assignment"}-${date}`,
        date,
        recommendedDate: date,
        status: "planned",
        moved: false,
        weekNumber: week?.weekNumber || weekIndex + 1,
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
    emptyDay,
    defaultProgram,
    defaultData,
    normalizeExercise,
    normalizeProgram,
    load,
    save,
    fromPublishedPlan,
    assignmentForDate,
    assignmentForId,
    allAssignments,
    allLogs,
    logForAssignment,
    logsForDate,
    isStandaloneLog,
    standaloneLogsForDate,
    programWeekIndexForDate,
    programWeekForDate,
    ensureAssignments,
    hasDraftChanges
  };
})();