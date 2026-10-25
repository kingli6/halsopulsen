(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WorkoutPlannerPlanningState = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const AVAILABILITIES = ["program", "independent", "both"];
  const clone = value => JSON.parse(JSON.stringify(value));

  function normalizeAvailability(value) {
    return AVAILABILITIES.includes(value) ? value : "program";
  }

  function emptyDay(weekday) {
    return {
      weekday,
      enabled: false,
      name: "",
      description: "",
      sessionType: "Rest / open day",
      availability: "program",
      warmup: "",
      cooldown: "",
      exercises: [],
      additionalWorkouts: []
    };
  }

  function normalizeDay(day) {
    if (!Array.isArray(day.exercises)) day.exercises = [];
    if (!Array.isArray(day.additionalWorkouts)) day.additionalWorkouts = [];
    day.availability = normalizeAvailability(day.availability);
    day.additionalWorkouts = day.additionalWorkouts.map(workout => ({
      ...workout,
      availability: normalizeAvailability(workout.availability),
      exercises: Array.isArray(workout.exercises) ? workout.exercises : []
    }));
    return day;
  }

  function ensureDay(week, weekday) {
    if (!Array.isArray(week.days)) week.days = [];
    let day = week.days.find(item => Number(item.weekday) === Number(weekday));
    if (!day) {
      day = emptyDay(Number(weekday));
      week.days.push(day);
      week.days.sort((a, b) => Number(a.weekday) - Number(b.weekday));
    }
    return normalizeDay(day);
  }

  function normalizeWeek(week) {
    if (!Array.isArray(week.days)) week.days = [];
    for (let weekday = 0; weekday < 7; weekday += 1) ensureDay(week, weekday);
    week.days.sort((a, b) => Number(a.weekday) - Number(b.weekday));
    return week;
  }

  function hasWorkout(workout) {
    return Boolean(workout && (
      workout.enabled ||
      workout.name ||
      (Array.isArray(workout.exercises) && workout.exercises.length)
    ));
  }

  function listSessions(day) {
    if (!day) return [];
    normalizeDay(day);
    return [
      ...(hasWorkout(day) ? [day] : []),
      ...day.additionalWorkouts
    ];
  }

  function getSession(day, index) {
    return listSessions(day)[Number(index)] || null;
  }

  function isScheduled(workout) {
    const availability = normalizeAvailability(workout && workout.availability);
    return availability === "program" || availability === "both";
  }

  function isIndependent(workout) {
    const availability = normalizeAvailability(workout && workout.availability);
    return availability === "independent" || availability === "both";
  }

  function sessionSnapshot(workout) {
    const snapshot = clone(workout);
    delete snapshot.weekday;
    delete snapshot.additionalWorkouts;
    snapshot.availability = normalizeAvailability(snapshot.availability);
    if (!Array.isArray(snapshot.exercises)) snapshot.exercises = [];
    return snapshot;
  }

  function replacePrimary(day, workout) {
    const weekday = Number(day.weekday);
    const additionalWorkouts = Array.isArray(day.additionalWorkouts) ? day.additionalWorkouts : [];
    const snapshot = sessionSnapshot(workout);
    Object.keys(day).forEach(key => delete day[key]);
    Object.assign(day, snapshot, { weekday, additionalWorkouts });
    return day;
  }

  function addSession(day, workout) {
    normalizeDay(day);
    const snapshot = sessionSnapshot(workout);
    snapshot.enabled = true;
    if (!hasWorkout(day)) {
      replacePrimary(day, snapshot);
      return 0;
    }
    day.additionalWorkouts.push(snapshot);
    return listSessions(day).length - 1;
  }

  function removeSession(day, index) {
    if (!day) return false;
    normalizeDay(day);
    const sessionIndex = Number(index);
    if (!Number.isInteger(sessionIndex) || sessionIndex < 0) return false;

    if (hasWorkout(day)) {
      if (sessionIndex === 0) {
        if (day.additionalWorkouts.length) {
          const [next, ...remaining] = day.additionalWorkouts;
          replacePrimary(day, next);
          day.additionalWorkouts = remaining;
        } else {
          replacePrimary(day, emptyDay(day.weekday));
        }
        return true;
      }
      const extraIndex = sessionIndex - 1;
      if (extraIndex >= day.additionalWorkouts.length) return false;
      day.additionalWorkouts.splice(extraIndex, 1);
      return true;
    }

    if (sessionIndex >= day.additionalWorkouts.length) return false;
    day.additionalWorkouts.splice(sessionIndex, 1);
    return true;
  }

  function moveSession(week, weekday, direction, sessionIndex) {
    const sourceWeekday = Number(weekday);
    const targetWeekday = sourceWeekday + Number(direction);
    if (
      !Number.isInteger(sourceWeekday) ||
      !Number.isInteger(targetWeekday) ||
      sourceWeekday < 0 ||
      sourceWeekday > 6 ||
      targetWeekday < 0 ||
      targetWeekday > 6
    ) return null;

    const source = ensureDay(week, sourceWeekday);
    const workout = getSession(source, sessionIndex);
    if (!workout) return null;
    const snapshot = sessionSnapshot(workout);
    if (!removeSession(source, sessionIndex)) return null;

    const destination = ensureDay(week, targetWeekday);
    const destinationIndex = addSession(destination, snapshot);
    return { sourceWeekday, targetWeekday, destinationIndex };
  }

  return {
    addSession,
    emptyDay,
    ensureDay,
    getSession,
    isIndependent,
    isScheduled,
    listSessions,
    moveSession,
    normalizeAvailability,
    normalizeDay,
    normalizeWeek,
    removeSession
  };
});
