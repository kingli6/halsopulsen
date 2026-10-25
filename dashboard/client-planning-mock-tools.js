(function attachClientPlanningMockTools(root) {
  "use strict";

  function isActive(day) {
    return Boolean(day && (day.enabled || day.exercises?.length));
  }

  function cloneWorkout(workout) {
    const copy = JSON.parse(JSON.stringify(workout || {}));
    delete copy.weekday;
    delete copy.additionalWorkouts;
    return copy;
  }

  function findDay(week, weekday) {
    return week?.days?.find(day => Number(day.weekday) === Number(weekday)) || null;
  }

  function listSessions(day) {
    if (!day) return [];
    const sessions = isActive(day) ? [day] : [];
    return sessions.concat(Array.isArray(day.additionalWorkouts) ? day.additionalWorkouts : []);
  }

  function getSession(day, index) {
    if (!day || !Number.isInteger(Number(index)) || Number(index) < 0) return null;
    return listSessions(day)[Number(index)] || null;
  }

  function replacePrimary(day, workout) {
    const weekday = day.weekday;
    Object.keys(day).forEach(key => {
      if (key !== "weekday") delete day[key];
    });
    Object.assign(day, cloneWorkout(workout), { weekday });
  }

  function clearDay(day) {
    replacePrimary(day, {
      enabled: false,
      name: "",
      description: "",
      sessionType: "Rest / open day",
      warmup: "",
      cooldown: "",
      exercises: [],
      additionalWorkouts: []
    });
  }

  function addSession(week, weekday, workout) {
    const day = findDay(week, weekday);
    if (!day) return -1;
    const sessions = listSessions(day);
    if (!sessions.length) {
      replacePrimary(day, workout);
      day.additionalWorkouts = [];
      return 0;
    }
    day.additionalWorkouts = Array.isArray(day.additionalWorkouts) ? day.additionalWorkouts : [];
    day.additionalWorkouts.push(cloneWorkout(workout));
    return day.additionalWorkouts.length;
  }

  function removeSession(week, weekday, sessionIndex) {
    const day = findDay(week, weekday);
    const index = Number(sessionIndex);
    if (!day || !Number.isInteger(index) || index < 0) return false;
    const sessions = listSessions(day);
    if (index >= sessions.length) return false;
    if (index > 0) {
      day.additionalWorkouts.splice(index - 1, 1);
      return true;
    }
    const extras = Array.isArray(day.additionalWorkouts) ? day.additionalWorkouts : [];
    if (extras.length) {
      const [promoted, ...remaining] = extras;
      replacePrimary(day, promoted);
      day.additionalWorkouts = remaining;
    } else {
      clearDay(day);
    }
    return true;
  }

  function moveSession(week, weekday, direction, sessionIndex = 0) {
    const sourceWeekday = Number(weekday);
    const targetWeekday = sourceWeekday + Number(direction);
    if (targetWeekday < 1 || targetWeekday > 7 || Math.abs(Number(direction)) !== 1) {
      return { moved: false, reason: "week-boundary" };
    }
    const source = findDay(week, sourceWeekday);
    const workout = getSession(source, Number(sessionIndex));
    if (!workout) return { moved: false, reason: "workout-not-found" };
    const snapshot = cloneWorkout(workout);
    if (!removeSession(week, sourceWeekday, Number(sessionIndex))) {
      return { moved: false, reason: "workout-not-found" };
    }
    const destinationIndex = addSession(week, targetWeekday, snapshot);
    return {
      moved: destinationIndex >= 0,
      sourceWeekday,
      targetWeekday,
      sessionIndex: destinationIndex
    };
  }

  const api = { addSession, findDay, getSession, listSessions, moveSession, removeSession };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ClientPlanningMockTools = api;
})(typeof window === "undefined" ? globalThis : window);
