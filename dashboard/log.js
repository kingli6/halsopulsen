const sharedTokenMatch = window.location.pathname.match(/^\/(?:p|dashboard\/share)\/([^/]+)\/?$/);
const logQuery = new URLSearchParams(window.location.search);
const logState = {
  data: null,
  isShared: Boolean(sharedTokenMatch),
  isPreview: logQuery.get("preview") === "1",
  shareToken: sharedTokenMatch?.[1] || "",
  selectedDate: TrackerData.todayISO(),
  selectedAssignmentId: null,
  editingAssignmentId: null,
  editingLogId: null,
  editingDate: null,
  moveSourceAssignmentId: null,
  logMode: "planned",
  weekOffset: 0,
  toastTimer: null,
  saving: false,
  saveQueue: Promise.resolve(),
  conflict: false
};

function setLogText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeLogHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function exerciseVideoSearchUrl(activity) {
  const name = String(activity?.name || "").trim();
  if (!name) return "";
  const query = `how to do ${name} exercise proper form`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function showLogToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(logState.toastTimer);
  logState.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function logIsReadOnly() {
  return logState.isPreview || logState.conflict;
}

function setPageMode() {
  const personName = logState.data?.person?.name || "";
  document.querySelectorAll("[data-owner-only]").forEach(element => {
    element.hidden = logState.isShared || logState.isPreview;
  });
  const clearLogsButton = document.getElementById("clearLogsBtn");
  if (clearLogsButton) clearLogsButton.disabled = logState.isShared || logIsReadOnly();
  if (logState.isPreview) {
    document.title = `${personName || "Participant"} preview — HälsoPulsen`;
    setLogText("storageNote", "Preview mode is read-only. Nothing you do here will be saved.");
    setLogText("insightHeading", "Preview only.");
    setLogText("insightText", "You are viewing the participant logging page as the owner. Logging, skipping, moving, and clearing sessions are disabled.");
    setLogText("participantEyebrow", `${personName || "PARTICIPANT"} · PREVIEW`);
    setLogText("participantPageHeading", `${personName || "Participant"}'s training plan`);
  } else if (logState.isShared) {
    document.title = `${personName || "Participant"}'s training log — HälsoPulsen`;
    setLogText("storageNote", "This shared plan is saved with the link so the owner can access the same record.");
    setLogText("insightHeading", "Your shared training log.");
    setLogText("insightText", "This page shows the published plan. Record the work here; changes to the program itself belong to the owner planning workspace.");
    setLogText("participantEyebrow", `${personName || "PARTICIPANT"}'S TRAINING LOG`);
    setLogText("participantPageHeading", `${personName || "Your"} training plan`);
  } else {
    setLogText("participantEyebrow", "PERSONAL TRAINING LOG");
    setLogText("participantPageHeading", "Follow the plan. Record what happened.");
  }
}

function renderModeBanner() {
  const banner = document.getElementById("modeBanner");
  const reloadButton = document.getElementById("reloadLogBtn");
  if (!banner) return;
  if (!logState.isPreview && !logState.conflict) {
    banner.hidden = true;
    return;
  }
  const personName = logState.data?.person?.name || "this participant";
  banner.hidden = false;
  banner.className = "mode-banner";
  if (logState.conflict) {
    setLogText("modeBannerTitle", "This training log changed elsewhere.");
    setLogText("modeBannerText", "Reload the latest version before saving so no session is lost.");
    if (reloadButton) reloadButton.hidden = false;
    return;
  }
  setLogText("modeBannerTitle", "Preview only — no changes will be saved.");
  setLogText("modeBannerText", `You are viewing ${personName}'s logging page as the owner. Logging, skipping, moving, and clearing are disabled.`);
  if (reloadButton) reloadButton.hidden = true;
}

async function persistState() {
  if (!logState.data) return;
  if (logState.isPreview) return;
  if (!logState.isShared) {
    TrackerData.save(logState.data);
    return true;
  }
  if (logState.conflict) return false;

  logState.saveQueue = logState.saveQueue.then(async () => {
    if (logState.conflict) return false;
    const snapshot = TrackerData.clone({
      assignments: logState.data.assignments,
      logs: logState.data.logs
    });
    const requestId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      logState.saving = true;
      const response = await fetch(`/api/plans/share/${encodeURIComponent(logState.shareToken)}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: snapshot.assignments,
          logs: snapshot.logs,
          stateRevision: logState.data.stateRevision,
          requestId
        })
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409 && result.conflict) {
        logState.conflict = true;
        renderModeBanner();
        renderAllLog();
        showLogToast(result.error || "This training log changed elsewhere. Reload the latest log.");
        return false;
      }
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "The shared log could not be saved.");
      }
      logState.data.stateRevision = Number(result.stateRevision) >= 0
        ? Number(result.stateRevision)
        : logState.data.stateRevision;
      return true;
    } catch (error) {
      showLogToast(error.message);
      return false;
    } finally {
      logState.saving = false;
    }
  });
  return logState.saveQueue;
}

function currentAssignment() {
  if (!logState.data) return null;
  const byId = logState.data.assignments.find(assignment => assignment.id === logState.selectedAssignmentId);
  if (byId && byId.date === logState.selectedDate) return byId;
  return TrackerData.assignmentForDate(logState.data, logState.selectedDate);
}

function workoutTitle(assignment) {
  return assignment?.workout?.name || "Training session";
}

function activitySummary(activity) {
  const target = TrackerData.targetLabel(activity);
  const intensity = activity.intensity ? ` · ${activity.intensity}` : "";
  const heartRate = activity.heartRateTarget ? ` · ${activity.heartRateTarget}` : "";
  const load = activity.load ? ` · ${activity.load} ${activity.loadUnit || "kg"}` : "";
  const tempo = activity.tempo ? ` · tempo ${activity.tempo}` : "";
  if (activity.activityType === "strength") {
    const effort = activity.rir != null ? ` · RIR ${activity.rir}` : "";
    return `${activity.sets} × ${target}${effort}${load}${tempo}`;
  }
  if (activity.activityType === "cardio" && activity.format === "intervals") {
    const work = activity.workDurationSeconds ? `${activity.workDurationSeconds}s work` : "work";
    const recovery = activity.recoveryDurationSeconds ? `${activity.recoveryDurationSeconds}s recovery` : "recovery";
    return `${activity.rounds || activity.targetValue} rounds · ${work} / ${recovery}${intensity}${heartRate}`;
  }
  if (activity.activityType === "guided") return `${activity.durationMinutes || activity.targetValue} min${intensity}`;
  return `${target}${intensity}${heartRate}`;
}

function workoutTarget(workout) {
  return workout.exercises.map(activity => `${activity.name} · ${activitySummary(activity)}${activity.notes ? ` · ${activity.notes}` : ""}`).join(" · ");
}

function standaloneLogTitle(log) {
  return log?.activity?.name || log?.workoutName || "Other activity";
}

function standaloneLogSummary(log) {
  const activity = log?.activity || log?.exercises?.[0] || {};
  return activity.targetValue ? `${activitySummary(activity)}${activity.intensity ? ` · ${activity.intensity}` : ""}` : "No amount recorded";
}

function planVersionForAssignment(assignmentId) {
  if (!logState.data) return "—";
  if (logState.data.assignments.some(assignment => assignment.id === assignmentId)) {
    return logState.data.publishedProgram?.version || 1;
  }
  const historical = (logState.data.history || []).find(item =>
    (item.assignments || []).some(assignment => assignment.id === assignmentId)
  );
  return historical?.version || "—";
}

function workCompletionRatio(assignment, log) {
  const plannedActivities = assignment?.workout?.exercises || [];
  if (!plannedActivities.length) return null;
  const ratios = [];
  plannedActivities.forEach((plannedActivity, activityIndex) => {
    const target = Number(plannedActivity.targetValue || plannedActivity.reps || 0);
    const setCount = Math.max(1, Number(plannedActivity.sets) || 1);
    const loggedActivity = log?.exercises?.[activityIndex];
    for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
      const completed = Number(loggedActivity?.sets?.[setIndex]?.completed || 0);
      ratios.push(target > 0 ? Math.min(1, Math.max(0, completed / target)) : completed > 0 ? 1 : 0);
    }
  });
  return ratios.length ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length : null;
}

function totalCompleted(exercises) {
  return exercises.reduce((total, activity) => total + activity.sets.reduce((sum, set) => sum + Number(set.completed || 0), 0), 0);
}

function isInRecentWindow(date) {
  const age = TrackerData.daysBetween(date, TrackerData.todayISO());
  return age >= 0 && age <= 13;
}

function recentAssignments() {
  if (!logState.data) return [];
  const byDate = new Map();
  TrackerData.allAssignments(logState.data)
    .filter(assignment => isInRecentWindow(assignment.date))
    .forEach(assignment => byDate.set(assignment.date, assignment));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function assignmentForDateIncludingHistory(date) {
  if (!logState.data) return null;
  return TrackerData.assignmentForDate(logState.data, date)
    || TrackerData.allAssignments(logState.data).find(assignment => assignment.date === date)
    || null;
}

function intensityOptions(selected = "") {
  return [
    ["", "Not recorded"],
    ["Easy", "Easy"],
    ["Steady", "Steady"],
    ["Moderate", "Moderate"],
    ["Tempo", "Tempo"],
    ["Hard", "Hard"]
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function renderGoal() {
  if (!logState.data) return;
  const published = logState.data.publishedProgram;
  const weeks = Array.isArray(published?.weeks) && published.weeks.length ? published.weeks : published ? [published] : [];
  const activeWeek = published ? (TrackerData.programWeekForDate(published, TrackerData.todayISO()) || weeks[0]) : null;
  const activeDays = activeWeek?.days.filter(day => day.enabled && day.exercises.length) || [];
  setLogText("goalHeading", logState.data.publishedGoal || logState.data.goal);
  setLogText("weekHeading", activeWeek ? `Week ${activeWeek.weekNumber} · choose a workout` : "Choose a workout");
  setLogText("goalText", published
    ? `${activeWeek?.phase || "Foundation"} · Week ${activeWeek?.weekNumber || 1} of ${weeks.length}${published.startDate ? ` · Starts ${TrackerData.formatShortDate(published.startDate)}` : ""}. ${activeDays.length} planned workout ${activeDays.length === 1 ? "day" : "days"} this week. Recommended days are a starting point, not a pass/fail test.`
    : "The owner has not published a program yet.");
  setLogText("publishedHeading", published?.name || "No program published yet");
  setLogText("publishedSummary", published
    ? `${published.description || "Published training plan."}${activeWeek?.progressionNotes ? ` Progression: ${activeWeek.progressionNotes}` : ""}${activeWeek?.successMetric ? ` Success metric: ${activeWeek.successMetric}` : ""}`
    : "The owner can create a week with different workouts for different days.");
  setLogText("publishedVersion", published ? `Version ${published.version} · published plan` : "Waiting for a plan");
  setLogText("publishedStatus", published ? `Published v${published.version}` : "No plan yet");
}

function renderToday() {
  if (!logState.data) return;
  const assignment = currentAssignment();
  if (assignment) logState.selectedDate = assignment.date;
  const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
  const date = assignment?.date || logState.selectedDate || TrackerData.todayISO();
  const otherLogs = TrackerData.standaloneLogsForDate(logState.data, date);
  const moveSource = logState.data.assignments.find(item => item.id === logState.moveSourceAssignmentId);
  const isToday = date === TrackerData.todayISO();
  setLogText("todayKicker", isToday ? "TODAY'S WORKOUT" : "SELECTED WORKOUT");
  setLogText("todayDate", TrackerData.formatLongDate(date));
  setLogText("todayHeading", assignment
    ? (isToday ? "Today's workout" : "Selected workout")
    : (date === TrackerData.todayISO() ? "Today's activities" : "Selected date"));
  setLogText("todaySubtitle", assignment
    ? (assignment.moved ? `Moved from ${TrackerData.formatShortDate(assignment.recommendedDate)} so it fits your week.` : "This workout was recommended for this day.")
    : "Nothing was planned here. You can still record something you did.");
  const statusElement = document.getElementById("todayStatus");
  statusElement.className = "status-pill";
  if (log || assignment?.status === "completed") {
    statusElement.classList.add("status-completed");
    statusElement.textContent = "Completed";
  } else if (otherLogs.length) {
    statusElement.classList.add("status-other");
    statusElement.textContent = "Other activity";
  } else if (assignment?.status === "skipped") {
    statusElement.classList.add("status-skipped");
    statusElement.textContent = "Skipped";
  } else if (assignment?.moved) {
    statusElement.classList.add("status-moved");
    statusElement.textContent = "Moved";
  } else {
    statusElement.classList.add(assignment ? "status-recommended" : "status-open");
    statusElement.textContent = assignment ? "Recommended" : "Open day";
  }

  const preview = document.getElementById("assignmentPreview");
  const activityRows = assignment?.workout?.exercises?.map((activity, activityIndex) => {
    const loggedActivity = log?.exercises?.[activityIndex];
    const loggedCompleted = loggedActivity?.sets?.reduce((total, set) => total + Number(set.completed || 0), 0);
    const loggedPlanned = loggedActivity?.sets?.reduce((total, set) => total + Number(set.planned || 0), 0);
    const completion = log && loggedActivity
      ? `<span class="today-activity-status">${loggedCompleted}/${loggedPlanned || loggedCompleted} logged</span>`
      : "";
    return `<div class="today-activity-row">
      <span class="today-activity-number">${activityIndex + 1}</span>
      <div class="today-activity-copy">
        <strong>${escapeLogHtml(activity.name)}</strong>
        <span>${escapeLogHtml(activitySummary(activity))}</span>
        ${activity.goal ? `<small>${escapeLogHtml(activity.goal)}</small>` : activity.description ? `<small>${escapeLogHtml(activity.description)}</small>` : ""}
      </div>
      ${completion}
    </div>`;
  }).join("");
  const plannedPreview = assignment
    ? `<div class="workout-summary">
        <div class="workout-summary-topline">
          <strong class="workout-name">${escapeLogHtml(workoutTitle(assignment))}</strong>
          <span class="workout-type">${escapeLogHtml(assignment.workout.sessionType || "Training")}</span>
          <span>${assignment.workout.exercises.length} ${assignment.workout.exercises.length === 1 ? "activity" : "activities"}</span>
        </div>
        ${assignment.workout.warmup ? `<p class="workout-note"><strong>Warm-up</strong> ${escapeLogHtml(assignment.workout.warmup)}</p>` : ""}
        <div class="today-activity-list">${activityRows || `<p class="empty-history">No activities have been added to this workout yet.</p>`}</div>
        ${assignment.workout.cooldown ? `<p class="workout-note"><strong>Cool-down</strong> ${escapeLogHtml(assignment.workout.cooldown)}</p>` : ""}
      </div>`
    : `<div class="empty-history">No planned workout on this date.</div>`;
  const otherPreview = otherLogs.map(otherLog => `<div class="assignment-main-chip other-activity-chip"><strong>${escapeLogHtml(standaloneLogTitle(otherLog))}</strong><span>Other activity · ${escapeLogHtml(standaloneLogSummary(otherLog))}</span></div>`).join("");
  preview.innerHTML = `${plannedPreview}${otherPreview}`;
  const logButton = document.getElementById("logAssignmentBtn");
  const skipButton = document.getElementById("skipAssignmentBtn");
  logButton.disabled = logIsReadOnly();
  logButton.textContent = logIsReadOnly()
    ? "Read-only"
    : log
      ? "Add another activity"
      : assignment
        ? (isToday ? "Log today's workout" : "Log this workout")
        : "Log something else";
  skipButton.disabled = logIsReadOnly() || !assignment || Boolean(log);
  const moveButton = document.getElementById("moveAssignmentBtn");
  moveButton.hidden = logIsReadOnly() || Boolean(assignment) || !moveSource || Boolean(TrackerData.logForAssignment(logState.data, moveSource.id));
  logState.selectedAssignmentId = assignment?.id || null;
}

function renderWeek() {
  if (!logState.data) return;
  const weekStart = TrackerData.addDays(TrackerData.startOfWeek(TrackerData.todayISO()), logState.weekOffset * 7);
  const weekEnd = TrackerData.addDays(weekStart, 6);
  const published = logState.data.publishedProgram;
  const activeWeek = published ? TrackerData.programWeekForDate(published, weekStart) : null;
  setLogText("weekLabel", activeWeek
    ? `Week ${activeWeek.weekNumber} · ${TrackerData.formatDateRange(weekStart, weekEnd)}`
    : (logState.weekOffset === 0 ? "This week" : TrackerData.formatDateRange(weekStart, weekEnd)));
  document.getElementById("dayGrid").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = TrackerData.addDays(weekStart, index);
    const assignment = TrackerData.assignmentForDate(logState.data, date);
    const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
    const otherLogs = TrackerData.standaloneLogsForDate(logState.data, date);
    const dateObject = TrackerData.fromISO(date);
    const isSelected = logState.selectedDate === date;
    const classes = ["day-tile"];
    if (date === TrackerData.todayISO()) classes.push("is-today");
    if (date < TrackerData.todayISO()) classes.push("is-past");
    if (isSelected) classes.push("selected");
    if (log || assignment?.status === "completed") classes.push("is-completed");
    else if (assignment?.moved) classes.push("is-moved");
    else if (otherLogs.length) classes.push("is-other");
    else if (!assignment) classes.push("is-open");
    const marker = log || assignment?.status === "completed"
      ? `<span class="day-marker complete">✓</span>`
      : assignment?.moved ? `<span class="day-marker moved"></span>` : otherLogs.length ? `<span class="day-marker other"></span>` : assignment ? `<span class="day-marker"></span>` : "";
    const content = assignment
      ? `<strong>${escapeLogHtml(workoutTitle(assignment))}</strong><span>${assignment.workout.exercises.length} activit${assignment.workout.exercises.length === 1 ? "y" : "ies"}${otherLogs.length ? ` · +${otherLogs.length} other` : ""}</span>`
      : otherLogs.length
        ? `<strong>${escapeLogHtml(standaloneLogTitle(otherLogs[0]))}</strong><span>${otherLogs.length > 1 ? `+${otherLogs.length - 1} other · ` : ""}Other activity</span>`
        : `<span>Rest / open day</span>`;
    const footer = assignment && !log && !assignment.moved ? `<span class="day-recommendation">recommended</span>` : "";
    return `<button class="${classes.join(" ")}" type="button" role="listitem" data-date="${date}" aria-label="${TrackerData.formatLongDate(date)}${assignment ? ", assignment" : otherLogs.length ? ", other activity logged" : ", rest or open day"}">
      ${marker}${date === TrackerData.todayISO() ? '<span class="today-badge">TODAY</span>' : ""}<span class="day-label">${TrackerData.DAY_NAMES[dateObject.getDay()]}</span><span class="day-number">${dateObject.getDate()}</span>
      <span class="day-content">${content}</span>${footer}</button>`;
  }).join("");
}

function weekAssignments() {
  if (!logState.data) return [];
  const start = TrackerData.startOfWeek(TrackerData.todayISO());
  const end = TrackerData.addDays(start, 6);
  return logState.data.assignments.filter(assignment => assignment.date >= start && assignment.date <= end);
}

function renderStats() {
  if (!logState.data) return;
  const assignments = recentAssignments();
  const completed = assignments.filter(assignment => Boolean(TrackerData.logForAssignment(logState.data, assignment.id))).length;
  const plannedRatios = assignments.map(assignment => workCompletionRatio(assignment, TrackerData.logForAssignment(logState.data, assignment.id)) || 0);
  const workRate = plannedRatios.length
    ? `${Math.round((plannedRatios.reduce((sum, ratio) => sum + ratio, 0) / plannedRatios.length) * 100)}%`
    : "—";
  const recentLogs = TrackerData.allLogs(logState.data).filter(log => isInRecentWindow(log.date));
  const plannedLogs = recentLogs.filter(log => !TrackerData.isStandaloneLog(log));
  setLogText("weekCompletion", `${weekAssignments().filter(assignment => Boolean(TrackerData.logForAssignment(logState.data, assignment.id))).length}/${weekAssignments().length}`);
  const currentWeekRate = weekAssignments().length
    ? Math.round((weekAssignments().filter(assignment => Boolean(TrackerData.logForAssignment(logState.data, assignment.id))).length / weekAssignments().length) * 100)
    : 0;
  document.getElementById("weekProgressBar").style.width = `${Math.min(100, currentWeekRate)}%`;
  setLogText("plannedSessions", `${completed}/${assignments.length}`);
  setLogText("workCompletion", workRate);
  const difficultyValues = plannedLogs.map(log => Number(log.difficulty)).filter(Boolean);
  setLogText("averageDifficulty", difficultyValues.length ? (difficultyValues.reduce((sum, value) => sum + value, 0) / difficultyValues.length).toFixed(1) : "—");
  const energyValues = plannedLogs.map(log => Number(log.energy)).filter(Boolean);
  setLogText("averageEnergy", energyValues.length ? (energyValues.reduce((sum, value) => sum + value, 0) / energyValues.length).toFixed(1) : "—");
}

function renderChart() {
  if (!logState.data) return;
  const chart = document.getElementById("progressChart");
  const start = TrackerData.addDays(TrackerData.todayISO(), -13);
  const values = Array.from({ length: 14 }, (_, index) => {
    const date = TrackerData.addDays(start, index);
    const assignment = assignmentForDateIncludingHistory(date);
    const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
    const otherLogs = TrackerData.standaloneLogsForDate(logState.data, date);
    const ratio = assignment ? workCompletionRatio(assignment, log) : null;
    return { date, assignment, log, otherLogs, ratio };
  });
  chart.innerHTML = values.map(value => {
    const ratio = value.ratio == null ? 0 : Math.round(value.ratio * 100);
    const title = `${TrackerData.formatShortDate(value.date)}${value.log ? `: ${ratio}% planned work completed` : value.assignment ? ": planned session not logged" : ": open"}${value.otherLogs.length ? ` · ${value.otherLogs.length} extra activity` : ""}`;
    return `<div class="chart-column ${value.assignment && !value.log ? "planned" : ""} ${value.otherLogs.length && !value.log ? "other" : ""}" title="${escapeLogHtml(title)}">
      <span class="chart-track"></span><span class="chart-bar" style="height:${value.log ? Math.max(5, ratio) : value.otherLogs.length ? 22 : 0}%"></span><span class="chart-label">${TrackerData.fromISO(value.date).getDate()}</span>
    </div>`;
  }).join("");
  setLogText("chartStart", TrackerData.formatShortDate(start));
  setLogText("chartEnd", TrackerData.formatShortDate(TrackerData.todayISO()));
  const extraCount = values.reduce((total, value) => total + value.otherLogs.length, 0);
  setLogText("chartNote", values.some(value => value.log || value.otherLogs.length || value.assignment)
    ? `Green bars show the share of planned work completed; dashed columns are planned sessions not logged.${extraCount ? " Blue bars show extra activity, which is not included in planned metrics." : ""}`
    : "Your planned work and extra activities will appear here.");
}

function renderHistory() {
  if (!logState.data) return;
  const list = document.getElementById("historyList");
  const logs = [...TrackerData.allLogs(logState.data)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  if (!logs.length) {
    list.innerHTML = `<div class="empty-history">No sessions logged yet.<br />Your history will appear here.</div>`;
    renderVersionHistory();
    return;
  }
  list.innerHTML = logs.map(log => {
    const editable = logState.data.logs.some(item => item.id === log.id) && !logIsReadOnly();
    const actions = editable
      ? `<div class="history-actions"><button class="text-button" type="button" data-edit-log="${escapeLogHtml(log.id)}">Edit</button><button class="text-button danger-button" type="button" data-delete-log="${escapeLogHtml(log.id)}">Delete</button></div>`
      : "";
    if (TrackerData.isStandaloneLog(log)) {
      return `<div class="history-item"><span class="history-check other-history-check">+</span><div class="history-details">
        <span class="history-title">${escapeLogHtml(standaloneLogTitle(log))}</span>
        <span class="history-meta">${TrackerData.formatLongDate(log.date)} · Other activity${log.difficulty ? ` · Difficulty ${log.difficulty}/10` : ""}</span>
      </div><span class="history-value">${escapeLogHtml(standaloneLogSummary(log))}</span>${actions}</div>`;
    }
    const assignment = TrackerData.assignmentForId(logState.data, log.assignmentId);
    const completed = totalCompleted(log.exercises);
    const planned = log.exercises.reduce((total, activity) => total + activity.sets.reduce((sum, set) => sum + Number(set.planned || 0), 0), 0);
    return `<div class="history-item"><span class="history-check">✓</span><div class="history-details">
      <span class="history-title">${escapeLogHtml(workoutTitle(assignment) || log.workoutName || "Training session")}</span>
      <span class="history-meta">${TrackerData.formatLongDate(log.date)} · Version ${planVersionForAssignment(log.assignmentId)}${log.difficulty ? ` · Difficulty ${log.difficulty}/10` : ""}</span>
    </div><span class="history-value">${TrackerData.targetLabel({ targetValue: completed, targetUnit: "reps" })}/${TrackerData.targetLabel({ targetValue: planned, targetUnit: "reps" })}</span>${actions}</div>`;
  }).join("");
  renderVersionHistory();
}

function renderVersionHistory() {
  const container = document.getElementById("versionHistory");
  if (!container || !logState.data) return;
  const versions = [
    ...(logState.data.publishedProgram ? [{
      version: logState.data.publishedProgram.version,
      name: logState.data.publishedProgram.name,
      publishedAt: logState.data.publishedAt,
      logs: logState.data.logs || [],
      current: true
    }] : []),
    ...(logState.data.history || []).map(item => ({ ...item, current: false }))
  ];
  if (!versions.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<p class="version-history-title">History by plan version</p>${versions.map(version => `
    <div class="version-history-item">
      <div><strong>Version ${escapeLogHtml(version.version)} · ${escapeLogHtml(version.name || "Training plan")}</strong><span>${version.current ? "Current plan" : "Archived plan"}${version.publishedAt ? ` · ${escapeLogHtml(TrackerData.formatShortDate(version.publishedAt.slice(0, 10)))}` : ""}</span></div>
      <b>${(version.logs || []).length} ${(version.logs || []).length === 1 ? "session" : "sessions"}</b>
    </div>
  `).join("")}`;
}

function renderAllLog() {
  renderGoal();
  renderToday();
  renderWeek();
  renderStats();
  renderChart();
  renderHistory();
}

function moveSelectedAssignment(targetDate) {
  if (logIsReadOnly()) {
    showLogToast(logState.conflict ? "Reload the latest log before moving workouts." : "Preview only. Moving workouts is disabled.");
    return;
  }
  const current = logState.data.assignments.find(item => item.id === logState.moveSourceAssignmentId);
  if (!current) {
    showLogToast("Select an unfinished workout first.");
    return;
  }
  if (TrackerData.logForAssignment(logState.data, current.id)) {
    showLogToast("That session is already logged.");
    return;
  }
  const existing = TrackerData.assignmentForDate(logState.data, targetDate);
  if (existing && existing.id !== current.id) {
    showLogToast("That date already has a planned workout.");
    renderAllLog();
    return;
  }
  const oldDate = current.date;
  current.date = targetDate;
  current.moved = current.recommendedDate !== targetDate;
  logState.selectedDate = targetDate;
  logState.selectedAssignmentId = current.id;
  logState.moveSourceAssignmentId = null;
  logState.data.assignments.sort((a, b) => a.date.localeCompare(b.date));
  persistState().then(saved => {
    if (saved) {
      showLogToast(oldDate === targetDate ? "Workout selected." : `Moved from ${TrackerData.formatShortDate(oldDate)} to ${TrackerData.formatShortDate(targetDate)}.`);
    }
  });
  renderAllLog();
}

function renderPlannedLogFields(assignment, existingLog = null) {
  document.getElementById("logExerciseFields").hidden = false;
  document.getElementById("logActivityFields").innerHTML = "";
  document.getElementById("logExerciseFields").innerHTML = assignment.workout.exercises.map((activity, activityIndex) => `
    <div class="log-exercise">
      <div class="log-exercise-heading"><div><h3>${escapeLogHtml(activity.name)}</h3><span>${escapeLogHtml(activitySummary(activity))}</span></div>${exerciseVideoSearchUrl(activity) ? `<a class="resource-link" href="${escapeLogHtml(exerciseVideoSearchUrl(activity))}" target="_blank" rel="noopener" aria-label="Find a video demo for ${escapeLogHtml(activity.name)}">Find a video demo ↗</a>` : ""}</div>
      ${activity.goal ? `<p class="log-activity-goal"><strong>Goal:</strong> ${escapeLogHtml(activity.goal)}</p>` : ""}
      ${activity.description ? `<p class="log-activity-goal">${escapeLogHtml(activity.description)}</p>` : ""}
      ${Array.from({ length: activity.sets }, (_, setIndex) => `<div class="set-row">
        <span>${activity.activityType === "strength" ? `Set ${setIndex + 1}` : activity.format === "intervals" ? "Rounds" : activity.activityType === "guided" ? "Session" : "Completed"}</span>
        <label><span class="sr-only">Planned target</span><input value="${escapeLogHtml(TrackerData.targetLabel(activity))}" disabled /></label>
        <label><span class="sr-only">Completed target</span><input type="number" min="0" step="${activity.activityType === "strength" && activity.targetUnit === "reps" ? "1" : "0.1"}" value="${existingLog?.exercises?.[activityIndex]?.sets?.[setIndex]?.completed ?? activity.targetValue}" data-completed-activity="${activityIndex}" data-completed-set="${setIndex}" /></label>
      </div>`).join("")}
      <label class="actual-intensity"><span>How did it feel? <em>(optional)</em></span><select data-actual-intensity="${activityIndex}">${intensityOptions(existingLog?.exercises?.[activityIndex]?.sets?.[0]?.intensity || activity.intensity)}</select></label>
    </div>`).join("");
}

function renderOtherLogFields(existingLog = null) {
  const activity = existingLog?.activity || {};
  const type = activity.activityType || "cardio";
  const unit = activity.targetUnit || "minutes";
  document.getElementById("logExerciseFields").hidden = true;
  document.getElementById("logExerciseFields").innerHTML = "";
  document.getElementById("logActivityFields").innerHTML = `
    <div class="other-log-intro">Keep it simple. Add the activity and the amount you want to remember.</div>
    <div class="form-grid">
      <label class="full-field">
        <span>What did you do?</span>
        <input id="otherActivityName" type="text" maxlength="100" placeholder="Evening bike ride" value="${escapeLogHtml(activity.name || existingLog?.workoutName || "")}" required />
      </label>
      <label>
        <span>Type</span>
        <select id="otherActivityType">
          <option value="strength" ${type === "strength" ? "selected" : ""}>Strength</option>
          <option value="cardio" ${type === "cardio" ? "selected" : ""}>Cardio</option>
          <option value="guided" ${type === "guided" ? "selected" : ""}>Mobility</option>
          <option value="other" ${type === "other" ? "selected" : ""}>Sport / other</option>
        </select>
      </label>
      <label>
        <span>Amount <em>(optional)</em></span>
        <input id="otherActivityValue" type="number" min="0" step="0.1" placeholder="35" value="${activity.targetValue ?? ""}" />
      </label>
      <label>
        <span>Unit</span>
        <select id="otherActivityUnit">
          <option value="minutes" ${unit === "minutes" ? "selected" : ""}>minutes</option>
          <option value="km" ${unit === "km" ? "selected" : ""}>kilometres</option>
          <option value="miles" ${unit === "miles" ? "selected" : ""}>miles</option>
          <option value="reps" ${unit === "reps" ? "selected" : ""}>reps</option>
          <option value="steps" ${unit === "steps" ? "selected" : ""}>steps</option>
          <option value="sessions" ${unit === "sessions" ? "selected" : ""}>sessions</option>
        </select>
      </label>
      <label>
        <span>Intensity <em>(optional)</em></span>
        <select id="otherActivityIntensity">${intensityOptions(activity.intensity || "")}</select>
      </label>
    </div>`;
}

function setLogMode(mode) {
  const assignment = logState.data?.assignments.find(item => item.id === logState.editingAssignmentId) || null;
  const plannedLog = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
  const existingLog = logState.data?.logs.find(item => item.id === logState.editingLogId) || null;
  const editingExisting = Boolean(logState.editingLogId);
  const plannedAllowed = editingExisting
    ? Boolean(existingLog?.assignmentId && assignment)
    : Boolean(assignment && !plannedLog);
  const otherAllowed = !editingExisting || !existingLog?.assignmentId;
  logState.logMode = mode === "planned" && plannedAllowed ? "planned" : "other";
  const plannedButton = document.getElementById("plannedLogModeBtn");
  const otherButton = document.getElementById("otherLogModeBtn");
  plannedButton.disabled = !plannedAllowed;
  otherButton.disabled = !otherAllowed;
  plannedButton.classList.toggle("is-selected", logState.logMode === "planned");
  plannedButton.setAttribute("aria-pressed", String(logState.logMode === "planned"));
  otherButton.classList.toggle("is-selected", logState.logMode === "other");
  otherButton.setAttribute("aria-pressed", String(logState.logMode === "other"));
  if (logState.logMode === "planned") renderPlannedLogFields(assignment, existingLog);
  else renderOtherLogFields(existingLog);
}

function openLogModal(logId = null) {
  if (logIsReadOnly()) {
    showLogToast(logState.conflict ? "Reload the latest log before recording activity." : "Preview only. Logging is disabled.");
    return;
  }
  const existingLog = logId ? logState.data.logs.find(item => item.id === logId) : null;
  if (logId && !existingLog) {
    showLogToast("That session is no longer available to edit.");
    return;
  }
  const assignment = existingLog?.assignmentId
    ? TrackerData.assignmentForId(logState.data, existingLog.assignmentId)
    : currentAssignment();
  const plannedLog = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
  logState.editingLogId = existingLog?.id || null;
  logState.editingAssignmentId = assignment?.id || null;
  logState.editingDate = existingLog?.date || logState.selectedDate || TrackerData.todayISO();
  setLogText("logModalTitle", existingLog ? "Edit activity" : "Log activity");
  setLogText("logModalContext", existingLog
    ? `Correct the details for ${TrackerData.formatLongDate(logState.editingDate)}.`
    : assignment && !plannedLog
    ? `Selected date: ${TrackerData.formatLongDate(logState.editingDate)}. Record what you actually completed.`
    : assignment
      ? `The planned workout is already logged for ${TrackerData.formatLongDate(logState.editingDate)}. Add another activity if you did more.`
      : `No workout was planned for ${TrackerData.formatLongDate(logState.editingDate)}. Record something else you did.`);
  setLogMode(existingLog?.assignmentId ? "planned" : assignment && !plannedLog ? "planned" : "other");
  document.getElementById("difficulty").value = existingLog?.difficulty || "";
  document.getElementById("energy").value = existingLog?.energy || "";
  document.getElementById("sessionNote").value = existingLog?.note || "";
  document.getElementById("saveLogBtn").textContent = existingLog ? "Update activity" : "Save activity";
  document.getElementById("logModal").hidden = false;
}

function saveLog(event) {
  event.preventDefault();
  if (logIsReadOnly()) {
    showLogToast(logState.conflict ? "Reload the latest log before saving." : "Preview only. Nothing will be saved.");
    return;
  }
  const assignment = logState.data.assignments.find(item => item.id === logState.editingAssignmentId) || null;
  const existingLog = logState.editingLogId
    ? logState.data.logs.find(item => item.id === logState.editingLogId)
    : null;
  if (logState.logMode === "planned" && !assignment) return;
  if (existingLog && Boolean(existingLog.assignmentId) !== (logState.logMode === "planned")) {
    showLogToast("Keep the activity type unchanged when editing a saved entry.");
    return;
  }
  let log;
  if (logState.logMode === "planned") {
    const exercises = assignment.workout.exercises.map((activity, activityIndex) => ({
      ...activity,
      sets: Array.from({ length: activity.sets }, (_, setIndex) => ({
        planned: activity.targetValue,
        completed: Math.max(0, Number(document.querySelector(`[data-completed-activity="${activityIndex}"][data-completed-set="${setIndex}"]`).value) || 0),
        intensity: document.querySelector(`[data-actual-intensity="${activityIndex}"]`)?.value || activity.intensity || ""
      }))
    }));
    log = {
      ...(existingLog || {}),
      id: `log-${Date.now()}`,
      assignmentId: assignment.id,
      source: "planned",
      workoutName: assignment.workout.name,
      date: assignment.date,
      exercises
    };
    log.id = existingLog?.id || log.id;
    logState.data.logs = logState.data.logs.filter(item => item.assignmentId !== assignment.id && item.id !== existingLog?.id);
    assignment.status = "completed";
  } else {
    const name = document.getElementById("otherActivityName")?.value.trim();
    if (!name) {
      showLogToast("Add an activity name first.");
      return;
    }
    const type = document.getElementById("otherActivityType").value;
    const value = Number(document.getElementById("otherActivityValue").value);
    log = {
      ...(existingLog || {}),
      id: `log-${Date.now()}`,
      assignmentId: null,
      source: "other",
      workoutName: name,
      date: logState.editingDate || logState.selectedDate,
      activity: {
        name,
        activityType: type,
        format: type === "strength" ? "sets" : "continuous",
        sets: 1,
        targetValue: value > 0 ? value : null,
        targetUnit: document.getElementById("otherActivityUnit").value,
        intensity: document.getElementById("otherActivityIntensity").value
      },
      exercises: [],
    };
  }
  log.difficulty = document.getElementById("difficulty").value;
  log.energy = document.getElementById("energy").value;
  log.note = document.getElementById("sessionNote").value.trim();
  log.id = existingLog?.id || log.id;
  log.createdAt = existingLog?.createdAt || new Date().toISOString();
  log.updatedAt = new Date().toISOString();
  if (existingLog) {
    logState.data.logs = logState.data.logs.map(item => item.id === existingLog.id ? log : item);
  } else {
    logState.data.logs.push(log);
  }
  const savedMessage = logState.logMode === "planned" ? "Planned session updated." : existingLog ? "Activity updated." : "Other activity saved.";
  logState.editingLogId = null;
  document.getElementById("logModal").hidden = true;
  document.getElementById("saveLogBtn").textContent = "Save activity";
  renderAllLog();
  persistState().then(saved => {
    if (saved) showLogToast(savedMessage);
  });
}

function deleteLog(logId) {
  if (logIsReadOnly()) {
    showLogToast(logState.conflict ? "Reload the latest log before deleting." : "Preview only. Sessions cannot be deleted.");
    return;
  }
  const log = logState.data.logs.find(item => item.id === logId);
  if (!log) {
    showLogToast("That session is no longer available.");
    return;
  }
  const assignment = log.assignmentId ? TrackerData.assignmentForId(logState.data, log.assignmentId) : null;
  const title = standaloneLogTitle(log);
  const message = assignment
    ? `Delete the logged ${title} session? The workout will be marked as planned again.`
    : `Delete ${title} from your history?`;
  if (!window.confirm(message)) return;
  logState.data.logs = logState.data.logs.filter(item => item.id !== logId);
  if (assignment && !TrackerData.logForAssignment(logState.data, assignment.id)) {
    assignment.status = "planned";
  }
  renderAllLog();
  persistState().then(saved => {
    if (saved) showLogToast(assignment ? "Session deleted. The workout is planned again." : "Activity deleted.");
  });
}

function skipAssignment() {
  if (logIsReadOnly()) {
    showLogToast(logState.conflict ? "Reload the latest log before changing this workout." : "Preview only. Skipping workouts is disabled.");
    return;
  }
  const assignment = currentAssignment();
  if (!assignment || TrackerData.logForAssignment(logState.data, assignment.id)) return;
  assignment.status = assignment.status === "skipped" ? "planned" : "skipped";
  renderAllLog();
  persistState().then(saved => {
    if (saved) showLogToast(assignment.status === "skipped" ? "Marked as skipped. You can still log it later." : "Workout reopened.");
  });
}

function exportCsv() {
  const rows = [["plan_version", "plan_state", "date", "recommended_date", "status", "workout", "session_type", "warmup", "cooldown", "activity", "prescription_format", "set_or_round", "planned_target", "completed_target", "unit", "planned_intensity", "actual_intensity", "rir", "pulse_target", "work_duration_seconds", "recovery_duration_seconds", "load", "load_unit", "tempo", "goal", "description", "activity_notes", "resource_url", "difficulty", "energy", "note"]];
  TrackerData.allAssignments(logState.data).forEach(assignment => {
    const log = TrackerData.logForAssignment(logState.data, assignment.id);
    const version = planVersionForAssignment(assignment.id);
    const state = version === (logState.data.publishedProgram?.version || 1) ? "current" : "archived";
    if (!log) {
      assignment.workout.exercises.forEach(activity => {
        for (let set = 1; set <= activity.sets; set += 1) rows.push([
          version, state, assignment.date, assignment.recommendedDate, assignment.status, assignment.workout.name,
          assignment.workout.sessionType, assignment.workout.warmup, assignment.workout.cooldown,
          activity.name, activity.format, set, activity.targetValue, "", activity.targetUnit, activity.intensity, "",
          activity.rir ?? "", activity.heartRateTarget, activity.workDurationSeconds ?? "", activity.recoveryDurationSeconds ?? "",
          activity.load, activity.loadUnit, activity.tempo, activity.goal, activity.description, activity.notes, activity.resourceUrl, "", "", ""
        ]);
      });
      return;
    }
    log.exercises.forEach(activity => activity.sets.forEach((set, index) => rows.push([
      version, state, log.date, assignment.recommendedDate, "completed", assignment.workout.name,
      assignment.workout.sessionType, assignment.workout.warmup, assignment.workout.cooldown,
      activity.name, activity.format, index + 1, set.planned, set.completed, activity.targetUnit, activity.intensity, set.intensity,
      activity.rir ?? "", activity.heartRateTarget, activity.workDurationSeconds ?? "", activity.recoveryDurationSeconds ?? "",
      activity.load, activity.loadUnit, activity.tempo, activity.goal, activity.description, activity.notes, activity.resourceUrl, log.difficulty, log.energy, log.note
    ])));
  });
  TrackerData.allLogs(logState.data).filter(TrackerData.isStandaloneLog).forEach(log => {
    const activity = log.activity || {};
    const row = Array(31).fill("");
    row[1] = "other";
    row[2] = log.date;
    row[4] = "completed";
    row[5] = log.workoutName || activity.name || "Other activity";
    row[6] = activity.activityType || "other";
    row[9] = activity.name || log.workoutName || "Other activity";
    row[10] = activity.format || "continuous";
    row[11] = 1;
    row[12] = activity.targetValue ?? "";
    row[13] = activity.targetValue ?? "";
    row[14] = activity.targetUnit || "";
    row[16] = activity.intensity || "";
    row[28] = log.difficulty || "";
    row[29] = log.energy || "";
    row[30] = log.note || "";
    rows.push(row);
  });
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `halsopulsen-training-${TrackerData.todayISO()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showLogToast("CSV exported.");
}

function clearLogs() {
  if (logState.isShared || logIsReadOnly()) {
    showLogToast(logState.conflict ? "Reload the latest log before clearing sessions." : "This page is read-only.");
    return;
  }
  if (!logState.data.logs.length || !window.confirm("Clear all logged sessions? Your program and assignments will remain.")) return;
  logState.data.logs = [];
  logState.data.assignments.forEach(assignment => {
    if (assignment.status === "completed") assignment.status = "planned";
  });
  renderAllLog();
  persistState().then(saved => {
    if (saved) showLogToast("Session logs cleared.");
  });
}

function bindLogEvents() {
  document.getElementById("dayGrid").addEventListener("click", event => {
    const tile = event.target.closest("[data-date]");
    if (!tile) return;
    const date = tile.dataset.date;
    const assignment = TrackerData.assignmentForDate(logState.data, date);
    logState.selectedDate = date;
    if (assignment) {
      logState.selectedAssignmentId = assignment.id;
      logState.moveSourceAssignmentId = TrackerData.logForAssignment(logState.data, assignment.id) ? null : assignment.id;
      showLogToast(TrackerData.logForAssignment(logState.data, assignment.id) ? "Completed session selected." : "Workout selected.");
      renderAllLog();
    } else {
      logState.selectedAssignmentId = null;
      showLogToast("Open day selected. You can log another activity here.");
      renderAllLog();
    }
  });
  document.getElementById("logAssignmentBtn").addEventListener("click", () => openLogModal());
  document.getElementById("skipAssignmentBtn").addEventListener("click", skipAssignment);
  document.getElementById("moveAssignmentBtn").addEventListener("click", () => moveSelectedAssignment(logState.selectedDate));
  document.getElementById("previousWeekBtn").addEventListener("click", () => { logState.weekOffset -= 1; renderWeek(); });
  document.getElementById("nextWeekBtn").addEventListener("click", () => { logState.weekOffset += 1; renderWeek(); });
  document.getElementById("todayBtn").addEventListener("click", () => {
    logState.weekOffset = 0;
    logState.selectedDate = TrackerData.todayISO();
    logState.selectedAssignmentId = TrackerData.assignmentForDate(logState.data, logState.selectedDate)?.id || null;
    logState.moveSourceAssignmentId = null;
    renderAllLog();
  });
  document.getElementById("plannedLogModeBtn").addEventListener("click", () => setLogMode("planned"));
  document.getElementById("otherLogModeBtn").addEventListener("click", () => setLogMode("other"));
  document.getElementById("exportBtn").addEventListener("click", exportCsv);
  document.getElementById("clearLogsBtn").addEventListener("click", clearLogs);
  document.getElementById("historyList").addEventListener("click", event => {
    const editButton = event.target.closest("[data-edit-log]");
    if (editButton) {
      openLogModal(editButton.dataset.editLog);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-log]");
    if (deleteButton) deleteLog(deleteButton.dataset.deleteLog);
  });
  document.getElementById("reloadLogBtn").addEventListener("click", () => window.location.reload());
  document.getElementById("closeLogModal").addEventListener("click", () => { document.getElementById("logModal").hidden = true; });
  document.getElementById("cancelLogBtn").addEventListener("click", () => { document.getElementById("logModal").hidden = true; });
  document.getElementById("logForm").addEventListener("submit", saveLog);
  document.getElementById("logModal").addEventListener("click", event => {
    if (event.target.id === "logModal") event.target.hidden = true;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") document.getElementById("logModal").hidden = true;
  });
}

async function bootstrapLog() {
  setPageMode();
  bindLogEvents();
  if (logState.isShared) {
    try {
      const response = await fetch(`/api/plans/share/${encodeURIComponent(logState.shareToken)}`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "This shared plan could not be loaded.");
      logState.data = TrackerData.fromPublishedPlan(result.plan);
       logState.data.stateRevision = Number(result.plan.stateRevision) >= 0
         ? Number(result.plan.stateRevision)
         : 0;
      TrackerData.ensureAssignments(logState.data);
      setPageMode();
      renderModeBanner();
      renderAllLog();
    } catch (error) {
      showLogToast(error.message);
      setLogText("todayHeading", "Shared plan unavailable");
      setLogText("todaySubtitle", "Ask the owner for a new link.");
    }
    return;
  }
  logState.data = TrackerData.load();
  TrackerData.ensureAssignments(logState.data);
  if (!logState.isPreview) TrackerData.save(logState.data);
  renderModeBanner();
  renderAllLog();
}

bootstrapLog();