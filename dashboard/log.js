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
  weekPointerId: null,
  weekPointerStartX: null,
  weekPointerStartY: null,
  weekPointerStartScrollLeft: 0,
  weekPointerMoved: false,
  suppressWeekClick: false,
  toastTimer: null,
  saving: false,
  saveQueue: Promise.resolve(),
  conflict: false,
  modalReturnFocus: null
};

function closeLogModal() {
  const modal = document.getElementById("logModal");
  if (modal) modal.hidden = true;
  if (logState.modalReturnFocus && typeof logState.modalReturnFocus.focus === "function") {
    logState.modalReturnFocus.focus();
  }
  logState.modalReturnFocus = null;
}

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

function isFutureDate(date) {
  return String(date || "") > TrackerData.todayISO();
}

function futureLoggingMessage(date) {
  return `Logging opens on ${TrackerData.formatLongDate(date)}.`;
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
  return TrackerData.assignmentForDate(logState.data, logState.selectedDate);
}

function assignmentForDisplayDate(date) {
  if (!logState.data) return null;
  return TrackerData.assignmentForDate(logState.data, date)
    || TrackerData.allAssignments(logState.data).find(assignment => assignment.date === date)
    || null;
}

function isCurrentAssignment(assignment) {
  return Boolean(assignment && logState.data?.assignments.some(item => item.id === assignment.id));
}

function isCurrentLog(log) {
  return Boolean(log && logState.data?.logs.some(item => item.id === log.id));
}

function isDeletableLog(log) {
  if (!isCurrentLog(log)) return false;
  if (!log?.assignmentId) return true;
  const assignment = TrackerData.assignmentForId(logState.data, log.assignmentId);
  return Boolean(assignment && isCurrentAssignment(assignment));
}

function logIsComplete(log) {
  return Boolean(log) && log.completed !== false;
}

function isEditableLog(log) {
  return Boolean(
    log
    && !logIsReadOnly()
    && !isFutureDate(log.date)
    && TrackerData.allLogs(logState.data).some(item => item === log || (item.id && item.id === log.id))
  );
}

function canEditWorkout(assignment) {
  return Boolean(assignment && !logIsReadOnly() && !isFutureDate(assignment.date));
}

function assignmentIsMissed(assignment) {
  return assignment?.status === "missed" || assignment?.status === "skipped";
}

function assignmentIsComplete(assignment) {
  if (!assignment || !logState.data) return false;
  const log = TrackerData.logForAssignment(logState.data, assignment.id);
  return log ? logIsComplete(log) : assignment.status === "completed";
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
  setLogText("weekHeading", activeWeek ? `Week ${activeWeek.weekNumber} · choose a day` : "Choose a day");
  setLogText("goalText", published
    ? `${activeWeek?.phase || "Foundation"} · Week ${activeWeek?.weekNumber || 1} of ${weeks.length}${published.startDate ? ` · Starts ${TrackerData.formatShortDate(published.startDate)}` : ""}. ${activeDays.length} planned workout ${activeDays.length === 1 ? "day" : "days"} this week. Planned days are a starting point, not a pass/fail test.`
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
  const assignment = assignmentForDisplayDate(logState.selectedDate);
  const isArchivedAssignment = Boolean(assignment && !isCurrentAssignment(assignment));
  const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
  const isComplete = log ? logIsComplete(log) : assignment?.status === "completed";
  const isRecorded = Boolean(log && !isComplete);
  const date = logState.selectedDate || TrackerData.todayISO();
  const otherLogs = TrackerData.standaloneLogsForDate(logState.data, date);
  const moveSource = logState.data.assignments.find(item => item.id === logState.moveSourceAssignmentId);
  const isToday = date === TrackerData.todayISO();
  const isFuture = isFutureDate(date);
  setLogText("todayKicker", isToday ? "TODAY'S WORKOUT" : isFuture ? "UPCOMING WORKOUT" : "SELECTED WORKOUT");
  setLogText("todayDate", TrackerData.formatLongDate(date));
  setLogText("todayHeading", assignment
    ? (isToday ? "Today's workout" : isFuture ? "Upcoming workout" : "Selected workout")
    : (date === TrackerData.todayISO() ? "Today's activities" : "Selected date"));
  setLogText("todaySubtitle", assignment
    ? (isFuture
      ? `This workout is planned for ${TrackerData.formatLongDate(date)}. ${futureLoggingMessage(date)}`
      : assignment.moved
        ? `Moved from ${TrackerData.formatShortDate(assignment.recommendedDate)} so it fits your week.`
        : "This workout is planned for this day.")
    : isFuture
      ? `Nothing is planned here. ${futureLoggingMessage(date)}`
      : "Nothing was planned here. You can still record something you did.");
  const statusElement = document.getElementById("todayStatus");
  statusElement.className = "status-pill";
  if (isArchivedAssignment) {
    statusElement.classList.add("status-archived");
    statusElement.textContent = `Archived plan${isComplete ? " · complete" : isRecorded ? " · recorded" : ""}`;
  } else if (isComplete) {
    statusElement.classList.add("status-completed");
    statusElement.textContent = "Completed";
  } else if (isRecorded) {
    statusElement.classList.add("status-recorded");
    statusElement.textContent = "Recorded";
  } else if (otherLogs.length) {
    statusElement.classList.add("status-other");
    statusElement.textContent = "Other activity";
  } else if (assignmentIsMissed(assignment)) {
    statusElement.classList.add("status-missed");
    statusElement.textContent = "Missed";
  } else if (assignment?.moved) {
    statusElement.classList.add("status-moved");
    statusElement.textContent = "Moved";
  } else if (isFuture) {
    statusElement.classList.add("status-upcoming");
    statusElement.textContent = "Upcoming";
  } else {
    statusElement.classList.add(assignment ? "status-planned" : "status-open");
    statusElement.textContent = assignment ? "Planned" : "Open day";
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
  const plannedEditButton = canEditWorkout(assignment)
    ? log
      ? `<button class="text-button" type="button" data-edit-log="${escapeLogHtml(log.id)}">Edit logged workout</button>`
      : `<button class="text-button" type="button" data-open-workout="${escapeLogHtml(assignment.id)}">Edit workout</button>`
    : "";
  const plannedPreview = assignment
    ? `<div class="workout-summary">
        <div class="workout-summary-topline">
          <strong class="workout-name">${escapeLogHtml(workoutTitle(assignment))}</strong>
          <span class="workout-type">${escapeLogHtml(assignment.workout.sessionType || "Training")}</span>
          <span>${assignment.workout.exercises.length} ${assignment.workout.exercises.length === 1 ? "activity" : "activities"}</span>
          ${plannedEditButton}
        </div>
        ${assignment.workout.warmup ? `<p class="workout-note"><strong>Warm-up</strong> ${escapeLogHtml(assignment.workout.warmup)}</p>` : ""}
        <div class="today-activity-list">${activityRows || `<p class="empty-history">No activities have been added to this workout yet.</p>`}</div>
        ${assignment.workout.cooldown ? `<p class="workout-note"><strong>Cool-down</strong> ${escapeLogHtml(assignment.workout.cooldown)}</p>` : ""}
      </div>`
    : `<div class="empty-history">No planned workout on this date.</div>`;
  const otherPreview = otherLogs.map(otherLog => `<div class="assignment-main-chip other-activity-chip">
    <div class="other-activity-heading"><strong>${escapeLogHtml(standaloneLogTitle(otherLog))}</strong>${isEditableLog(otherLog) ? `<button class="text-button" type="button" data-edit-log="${escapeLogHtml(otherLog.id)}">Edit</button>` : ""}</div>
    <span>Other activity · ${escapeLogHtml(standaloneLogSummary(otherLog))}</span>
  </div>`).join("");
  preview.innerHTML = `${plannedPreview}${otherPreview}`;
  const logButton = document.getElementById("logAssignmentBtn");
  const otherActivityButton = document.getElementById("logOtherActivityBtn");
  const skipButton = document.getElementById("skipAssignmentBtn");
  const canEditPlannedLog = Boolean(log && isEditableLog(log));
  logButton.disabled = logIsReadOnly() || isFuture;
  logButton.textContent = logIsReadOnly()
    ? "Read-only"
    : isFuture
      ? "Logging opens later"
      : canEditPlannedLog
          ? "Edit logged workout"
          : assignment
            ? "Edit workout"
            : "Log other activity";
  otherActivityButton.hidden = logIsReadOnly() || isFuture || !assignment || isArchivedAssignment;
  otherActivityButton.disabled = logIsReadOnly() || isFuture;
  skipButton.textContent = assignmentIsMissed(assignment) ? "Restore workout" : "Mark as missed";
  skipButton.title = assignmentIsMissed(assignment)
    ? "Put this planned workout back on your active schedule"
    : "Record that this planned workout was not completed";
  skipButton.disabled = logIsReadOnly() || isFuture || isArchivedAssignment || !assignment || Boolean(log);
  const moveButton = document.getElementById("moveAssignmentBtn");
  moveButton.hidden = logIsReadOnly() || isFuture || Boolean(assignment) || !moveSource || Boolean(TrackerData.logForAssignment(logState.data, moveSource.id));
  setLogText("todayHelperCopy", isFuture
    ? "Logging is disabled until this day arrives. You can review the planned workout now."
    : isArchivedAssignment
      ? log
        ? "The archived workout prescription stays unchanged, but you can edit the recorded session or add other activity on this date."
        : "The archived workout prescription stays unchanged, but you can edit and record what happened on this past date."
      : assignmentIsMissed(assignment)
        ? "This workout is marked as missed. Restore it if you decide to complete it."
        : "Planned days are a guide. Move unfinished work when real life gets in the way.");
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
  setLogText("weekHeading", activeWeek ? `Week ${activeWeek.weekNumber} · choose a day` : "Choose a day");
  document.getElementById("dayGrid").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = TrackerData.addDays(weekStart, index);
    const assignment = assignmentForDisplayDate(date);
    const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
    const otherLogs = TrackerData.standaloneLogsForDate(logState.data, date);
    const dateObject = TrackerData.fromISO(date);
    const isSelected = logState.selectedDate === date;
    const isArchivedAssignment = Boolean(assignment && !isCurrentAssignment(assignment));
    const classes = ["day-tile"];
    if (date === TrackerData.todayISO()) classes.push("is-today");
    if (date < TrackerData.todayISO()) classes.push("is-past");
    if (isSelected) classes.push("selected");
    const isComplete = log ? logIsComplete(log) : assignment?.status === "completed";
    const isRecorded = Boolean(log && !isComplete);
    if (isComplete) classes.push("is-completed");
    else if (isRecorded) classes.push("is-recorded");
    else if (assignmentIsMissed(assignment)) classes.push("is-missed");
    else if (assignment?.moved) classes.push("is-moved");
    else if (otherLogs.length) classes.push("is-other");
    else if (!assignment) classes.push("is-open");
    const status = isArchivedAssignment
      ? `Archived plan${isComplete ? " · complete" : isRecorded ? " · recorded" : ""}`
      : isComplete
        ? "Completed"
      : isRecorded
        ? "Recorded"
      : assignmentIsMissed(assignment)
        ? "Missed"
        : assignment?.moved
          ? "Moved"
          : assignment
            ? isArchivedAssignment ? "Archived plan" : "Planned"
            : otherLogs.length
              ? "Other activity"
              : "Open day";
    const marker = isComplete
      ? `<span class="day-marker complete">✓</span>`
      : isRecorded ? `<span class="day-marker recorded"></span>`
        : assignmentIsMissed(assignment) ? `<span class="day-marker missed"></span>`
          : assignment?.moved ? `<span class="day-marker moved"></span>` : otherLogs.length ? `<span class="day-marker other"></span>` : assignment ? `<span class="day-marker"></span>` : "";
    const content = assignment
      ? `<strong>${escapeLogHtml(workoutTitle(assignment))}</strong><span>${assignment.workout.exercises.length} activit${assignment.workout.exercises.length === 1 ? "y" : "ies"}${otherLogs.length ? ` · +${otherLogs.length} other` : ""}</span>`
      : otherLogs.length
        ? `<strong>${escapeLogHtml(standaloneLogTitle(otherLogs[0]))}</strong><span>${otherLogs.length > 1 ? `+${otherLogs.length - 1} other · ` : ""}Other activity</span>`
        : `<span>Rest / open day</span>`;
    return `<button class="${classes.join(" ")}" type="button" data-date="${date}" aria-pressed="${isSelected}" ${date === TrackerData.todayISO() ? 'aria-current="date"' : ""} aria-label="${TrackerData.formatLongDate(date)}, ${status}${assignment ? `, ${escapeLogHtml(workoutTitle(assignment))}` : otherLogs.length ? ", other activity logged" : ", rest or open day"}">
      ${marker}${date === TrackerData.todayISO() ? '<span class="today-badge">TODAY</span>' : ""}<span class="day-label">${TrackerData.DAY_NAMES[dateObject.getDay()]}</span><span class="day-number">${dateObject.getDate()}</span>
      <span class="day-content">${content}</span></button>`;
  }).join("");
  if (window.matchMedia("(max-width: 620px)").matches) {
    requestAnimationFrame(() => {
      const selected = document.querySelector(".day-tile.selected");
      if (selected) {
        const dayGrid = document.getElementById("dayGrid");
        const targetLeft = selected.offsetLeft - Math.max(0, (dayGrid.clientWidth - selected.offsetWidth) / 2);
        dayGrid.scrollTo({ left: targetLeft, behavior: "smooth" });
      }
    });
  }
}

function weekStartForOffset(offset) {
  return TrackerData.addDays(TrackerData.startOfWeek(TrackerData.todayISO()), offset * 7);
}

function selectFirstDateInWeek(offset) {
  const start = weekStartForOffset(offset);
  const end = TrackerData.addDays(start, 6);
  const dates = [...new Set(TrackerData.allAssignments(logState.data)
    .filter(item => item.date >= start && item.date <= end)
    .map(item => item.date))].sort();
  const selectedDate = dates[0] || start;
  const assignment = assignmentForDisplayDate(selectedDate);
  logState.selectedDate = selectedDate;
  logState.selectedAssignmentId = assignment?.id || null;
  logState.moveSourceAssignmentId = null;
}

function shiftWeek(amount) {
  logState.weekOffset += amount;
  selectFirstDateInWeek(logState.weekOffset);
  renderAllLog();
}

function weekAssignments() {
  if (!logState.data) return [];
  const start = TrackerData.startOfWeek(TrackerData.todayISO());
  const end = TrackerData.addDays(start, 6);
  const assignmentsByDate = new Map();
  TrackerData.allAssignments(logState.data)
    .filter(assignment => assignment.date >= start && assignment.date <= end)
    .forEach(assignment => assignmentsByDate.set(assignment.date, assignment));
  return [...assignmentsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function renderStats() {
  if (!logState.data) return;
  const assignments = recentAssignments();
  const completed = assignments.filter(assignment => assignmentIsComplete(assignment)).length;
  const plannedRatios = assignments.map(assignment => {
    const log = TrackerData.logForAssignment(logState.data, assignment.id);
    return logIsComplete(log) ? (workCompletionRatio(assignment, log) || 0) : 0;
  });
  const workRate = plannedRatios.length
    ? `${Math.round((plannedRatios.reduce((sum, ratio) => sum + ratio, 0) / plannedRatios.length) * 100)}%`
    : "—";
  const recentLogs = TrackerData.allLogs(logState.data).filter(log => isInRecentWindow(log.date));
  const plannedLogs = recentLogs.filter(log => !TrackerData.isStandaloneLog(log));
  setLogText("weekCompletion", `${weekAssignments().filter(assignment => assignmentIsComplete(assignment)).length}/${weekAssignments().length}`);
  const currentWeekRate = weekAssignments().length
    ? Math.round((weekAssignments().filter(assignment => assignmentIsComplete(assignment)).length / weekAssignments().length) * 100)
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
    const markedComplete = logIsComplete(value.log);
    const title = `${TrackerData.formatShortDate(value.date)}${value.log
      ? markedComplete ? `: ${ratio}% planned work completed` : `: ${ratio}% recorded, not marked complete`
      : value.assignment ? ": planned session not logged" : ": open"}${value.otherLogs.length ? ` · ${value.otherLogs.length} extra activity` : ""}`;
    return `<div class="chart-column ${value.assignment && !value.log ? "planned" : ""} ${value.log && !markedComplete ? "recorded" : ""} ${value.otherLogs.length && !value.log ? "other" : ""}" title="${escapeLogHtml(title)}">
      <span class="chart-track"></span><span class="chart-bar" style="height:${value.log ? Math.max(5, ratio) : value.otherLogs.length ? 22 : 0}%"></span><span class="chart-label">${TrackerData.fromISO(value.date).getDate()}</span>
    </div>`;
  }).join("");
  setLogText("chartStart", TrackerData.formatShortDate(start));
  setLogText("chartEnd", TrackerData.formatShortDate(TrackerData.todayISO()));
  const extraCount = values.reduce((total, value) => total + value.otherLogs.length, 0);
  setLogText("chartNote", values.some(value => value.log || value.otherLogs.length || value.assignment)
    ? `Green bars show completed planned work; blue-gray bars are recorded but not marked complete; dashed columns are planned sessions not logged.${extraCount ? " Blue activity bars are not included in planned metrics." : ""}`
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
    const editable = isEditableLog(log);
    const assignment = log.assignmentId ? TrackerData.assignmentForId(logState.data, log.assignmentId) : null;
    const archivedNote = log.assignmentId && assignment && !isCurrentAssignment(assignment)
      ? " · Archived plan"
      : "";
    const deleteAction = isDeletableLog(log)
      ? `<button class="text-button danger-button" type="button" data-delete-log="${escapeLogHtml(log.id)}">Delete</button>`
      : "";
    const actions = editable
      ? `<div class="history-actions"><button class="text-button" type="button" data-edit-log="${escapeLogHtml(log.id)}">Edit</button>${deleteAction}</div>`
      : "";
    if (TrackerData.isStandaloneLog(log)) {
      return `<div class="history-item"><span class="history-check other-history-check">+</span><div class="history-details">
        <span class="history-title">${escapeLogHtml(standaloneLogTitle(log))}</span>
        <span class="history-meta">${TrackerData.formatLongDate(log.date)} · Other activity${log.difficulty ? ` · Difficulty ${log.difficulty}/10` : ""}${archivedNote}</span>
      </div><span class="history-value">${escapeLogHtml(standaloneLogSummary(log))}</span>${actions}</div>`;
    }
    const completed = totalCompleted(log.exercises);
    const planned = log.exercises.reduce((total, activity) => total + activity.sets.reduce((sum, set) => sum + Number(set.planned || 0), 0), 0);
    const markedComplete = logIsComplete(log);
    return `<div class="history-item"><span class="history-check${markedComplete ? "" : " is-recorded"}">${markedComplete ? "✓" : "•"}</span><div class="history-details">
      <span class="history-title">${escapeLogHtml(workoutTitle(assignment) || log.workoutName || "Training session")}</span>
      <span class="history-meta">${TrackerData.formatLongDate(log.date)} · ${markedComplete ? "Completed" : "Recorded"} · Version ${planVersionForAssignment(log.assignmentId)}${log.difficulty ? ` · Difficulty ${log.difficulty}/10` : ""}${archivedNote}</span>
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
  if (isFutureDate(targetDate)) {
    showLogToast(futureLoggingMessage(targetDate));
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
  document.getElementById("plannedCompletionField").hidden = false;
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
  document.getElementById("plannedCompletionField").hidden = true;
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
  const assignment = logState.data
    ? TrackerData.assignmentForId(logState.data, logState.editingAssignmentId)
    : null;
  const plannedLog = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
  const existingLog = logState.data
    ? TrackerData.allLogs(logState.data).find(item => item.id === logState.editingLogId) || null
    : null;
  const editingExisting = Boolean(logState.editingLogId);
  const plannedAllowed = editingExisting
    ? Boolean(existingLog?.assignmentId && assignment)
    : Boolean(assignment && !plannedLog && !isFutureDate(assignment.date));
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

function openLogModal(logId = null, requestedMode = null) {
  if (logIsReadOnly()) {
    showLogToast(logState.conflict ? "Reload the latest log before recording activity." : "Preview only. Logging is disabled.");
    return;
  }
  const existingLog = logId ? TrackerData.allLogs(logState.data).find(item => item.id === logId) : null;
  if (logId && !existingLog) {
    showLogToast("That session is no longer available to edit.");
    return;
  }
  const modalDate = existingLog?.date || logState.selectedDate || TrackerData.todayISO();
  if (isFutureDate(modalDate)) {
    showLogToast(futureLoggingMessage(modalDate));
    return;
  }
  const assignment = existingLog?.assignmentId
    ? TrackerData.assignmentForId(logState.data, existingLog.assignmentId)
    : assignmentForDisplayDate(modalDate);
  if (existingLog && !isEditableLog(existingLog)) {
    showLogToast("This session cannot be edited.");
    return;
  }
  const plannedAssignment = existingLog?.assignmentId
    ? assignment
    : assignment && !isFutureDate(assignment.date)
      ? assignment
      : null;
  const plannedLog = plannedAssignment ? TrackerData.logForAssignment(logState.data, plannedAssignment.id) : null;
  logState.editingLogId = existingLog?.id || null;
  logState.editingAssignmentId = plannedAssignment?.id || null;
  logState.editingDate = modalDate;
  logState.modalReturnFocus = document.activeElement;
  const openingOtherActivity = requestedMode === "other" || (existingLog && !existingLog.assignmentId);
  setLogText("logModalTitle", existingLog
    ? (existingLog.assignmentId ? "Edit logged workout" : "Edit other activity")
    : openingOtherActivity ? "Log other activity" : "Log planned workout");
  setLogText("logModalContext", existingLog
    ? `Correct the details for ${TrackerData.formatLongDate(logState.editingDate)}.`
    : openingOtherActivity
      ? `Selected date: ${TrackerData.formatLongDate(logState.editingDate)}. Record activity that was not part of the planned workout.`
    : plannedAssignment && !plannedLog
    ? `Selected date: ${TrackerData.formatLongDate(logState.editingDate)}. Record what you actually completed.`
    : plannedAssignment
      ? `The planned workout is already logged for ${TrackerData.formatLongDate(logState.editingDate)}. Add another activity if you did more.`
      : `No workout was planned for ${TrackerData.formatLongDate(logState.editingDate)}. Record something else you did.`);
  setLogMode(existingLog
    ? (existingLog.assignmentId ? "planned" : "other")
    : requestedMode || (plannedAssignment && !plannedLog ? "planned" : "other"));
  const completionField = document.getElementById("markWorkoutComplete");
  completionField.checked = existingLog ? logIsComplete(existingLog) : false;
  document.getElementById("difficulty").value = existingLog?.difficulty || "";
  document.getElementById("energy").value = existingLog?.energy || "";
  document.getElementById("sessionNote").value = existingLog?.note || "";
  document.getElementById("saveLogBtn").textContent = existingLog ? "Update activity" : "Save activity";
  document.getElementById("logModal").hidden = false;
  document.getElementById("closeLogModal").focus();
}

function saveLog(event) {
  event.preventDefault();
  if (logIsReadOnly()) {
    showLogToast(logState.conflict ? "Reload the latest log before saving." : "Preview only. Nothing will be saved.");
    return;
  }
  const saveDate = logState.editingDate || logState.selectedDate || TrackerData.todayISO();
  if (isFutureDate(saveDate)) {
    showLogToast(futureLoggingMessage(saveDate));
    return;
  }
  const assignment = TrackerData.assignmentForId(logState.data, logState.editingAssignmentId);
  const existingLog = logState.editingLogId
    ? TrackerData.allLogs(logState.data).find(item => item.id === logState.editingLogId)
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
      completed: document.getElementById("markWorkoutComplete").checked,
      exercises
    };
    log.id = existingLog?.id || log.id;
    logState.data.logs = logState.data.logs.filter(item => item.assignmentId !== assignment.id && item.id !== existingLog?.id);
    if (isCurrentAssignment(assignment)) {
      assignment.status = log.completed ? "completed" : "planned";
    }
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
      completed: true,
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
    const existingIndex = logState.data.logs.findIndex(item =>
      item.id === existingLog.id
      || (log.assignmentId && item.assignmentId === log.assignmentId)
    );
    if (existingIndex >= 0) {
      logState.data.logs = logState.data.logs.map((item, index) => index === existingIndex ? log : item);
    } else {
      logState.data.logs.push(log);
    }
  } else {
    logState.data.logs.push(log);
  }
  const savedMessage = logState.logMode === "planned"
    ? (log.completed ? "Planned workout marked complete." : "Workout recorded. Mark it complete when you are done.")
    : existingLog ? "Activity updated." : "Other activity saved.";
  logState.editingLogId = null;
  closeLogModal();
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
  if (!isDeletableLog(log)) {
    showLogToast("Archived plan sessions can be corrected but not deleted.");
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
  if (!isCurrentAssignment(assignment)) {
    showLogToast("Archived plan entries are read-only.");
    return;
  }
  if (isFutureDate(assignment.date)) {
    showLogToast(futureLoggingMessage(assignment.date));
    return;
  }
  assignment.status = assignmentIsMissed(assignment) ? "planned" : "missed";
  renderAllLog();
  persistState().then(saved => {
    if (saved) showLogToast(assignment.status === "missed" ? "Marked as missed. You can still log it later." : "Workout restored.");
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
    const exportStatus = logIsComplete(log) ? "completed" : "recorded";
    log.exercises.forEach(activity => activity.sets.forEach((set, index) => rows.push([
      version, state, log.date, assignment.recommendedDate, exportStatus, assignment.workout.name,
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
  if (!logState.data.logs.length || !window.confirm("Clear current-plan logs? Archived plan history will remain read-only.")) return;
  logState.data.logs = [];
  logState.data.assignments.forEach(assignment => {
    if (assignment.status === "completed") assignment.status = "planned";
  });
  renderAllLog();
  persistState().then(saved => {
    if (saved) showLogToast("Current-plan session logs cleared.");
  });
}

function bindLogEvents() {
  const dayGrid = document.getElementById("dayGrid");
  dayGrid.addEventListener("click", event => {
    if (logState.suppressWeekClick) {
      logState.suppressWeekClick = false;
      return;
    }
    const tile = event.target.closest(".day-tile");
    if (!tile || !dayGrid.contains(tile)) return;
    const date = tile.dataset.date;
    const assignment = assignmentForDisplayDate(date);
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
  dayGrid.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    logState.suppressWeekClick = false;
    logState.weekPointerId = event.pointerId;
    logState.weekPointerStartX = event.clientX;
    logState.weekPointerStartY = event.clientY;
    logState.weekPointerStartScrollLeft = dayGrid.scrollLeft;
    logState.weekPointerMoved = false;
    dayGrid.classList.add("is-dragging");
  });
  dayGrid.addEventListener("pointermove", event => {
    if (event.pointerId !== logState.weekPointerId) return;
    const deltaX = event.clientX - logState.weekPointerStartX;
    const deltaY = event.clientY - logState.weekPointerStartY;
    if (!logState.weekPointerMoved) {
      if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return;
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
      logState.weekPointerMoved = true;
      dayGrid.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    dayGrid.scrollLeft = logState.weekPointerStartScrollLeft - deltaX;
  });
  const finishWeekPointer = event => {
    if (event.pointerId !== logState.weekPointerId) return;
    const deltaX = event.clientX - logState.weekPointerStartX;
    const horizontalDrag = logState.weekPointerMoved && Math.abs(deltaX) > 40;
    const atStart = dayGrid.scrollLeft <= 4;
    const atEnd = dayGrid.scrollLeft + dayGrid.clientWidth >= dayGrid.scrollWidth - 4;
    const shouldGoPrevious = horizontalDrag && deltaX > 0 && atStart;
    const shouldGoNext = horizontalDrag && deltaX < 0 && atEnd;
    logState.suppressWeekClick = logState.weekPointerMoved;
    dayGrid.classList.remove("is-dragging");
    dayGrid.releasePointerCapture?.(event.pointerId);
    logState.weekPointerId = null;
    logState.weekPointerStartX = null;
    logState.weekPointerStartY = null;
    logState.weekPointerMoved = false;
    if (shouldGoPrevious) shiftWeek(-1);
    if (shouldGoNext) shiftWeek(1);
  };
  dayGrid.addEventListener("pointerup", finishWeekPointer);
  dayGrid.addEventListener("pointercancel", finishWeekPointer);
  document.getElementById("assignmentPreview").addEventListener("click", event => {
    const editButton = event.target.closest("[data-edit-log]");
    if (editButton) openLogModal(editButton.dataset.editLog);
    const workoutButton = event.target.closest("[data-open-workout]");
    if (workoutButton) openLogModal(null, "planned");
  });
  document.getElementById("logAssignmentBtn").addEventListener("click", () => {
    const assignment = assignmentForDisplayDate(logState.selectedDate);
    const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
    if (log && isEditableLog(log)) {
      openLogModal(log.id);
      return;
    }
    const mode = assignment ? "planned" : "other";
    openLogModal(null, mode);
  });
  document.getElementById("logOtherActivityBtn").addEventListener("click", () => {
    openLogModal(null, "other");
  });
  document.getElementById("skipAssignmentBtn").addEventListener("click", skipAssignment);
  document.getElementById("moveAssignmentBtn").addEventListener("click", () => moveSelectedAssignment(logState.selectedDate));
  document.getElementById("previousWeekBtn").addEventListener("click", () => shiftWeek(-1));
  document.getElementById("nextWeekBtn").addEventListener("click", () => shiftWeek(1));
  document.getElementById("todayBtn").addEventListener("click", () => {
    logState.weekOffset = 0;
    logState.selectedDate = TrackerData.todayISO();
    logState.selectedAssignmentId = assignmentForDisplayDate(logState.selectedDate)?.id || null;
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
  document.getElementById("closeLogModal").addEventListener("click", closeLogModal);
  document.getElementById("cancelLogBtn").addEventListener("click", closeLogModal);
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