const sharedTokenMatch = window.location.pathname.match(/^\/dashboard\/share\/([^/]+)\/?$/);
const logState = {
  data: null,
  isShared: Boolean(sharedTokenMatch),
  shareToken: sharedTokenMatch?.[1] || "",
  selectedDate: TrackerData.todayISO(),
  selectedAssignmentId: null,
  editingAssignmentId: null,
  weekOffset: 0,
  toastTimer: null,
  saving: false
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

function showLogToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(logState.toastTimer);
  logState.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function setPageMode() {
  document.querySelectorAll("[data-owner-only]").forEach(element => {
    element.hidden = logState.isShared;
  });
  if (logState.isShared) {
    document.title = "Shared training plan — HälsoPulsen";
    setLogText("storageNote", "This shared plan is saved with the link so the owner can access the same record.");
    setLogText("insightHeading", "Your shared training log.");
    setLogText("insightText", "This page shows the published plan. Record the work here; changes to the program itself belong to the owner planning workspace.");
    const eyebrow = document.querySelector(".page-intro .eyebrow");
    if (eyebrow) eyebrow.textContent = "SHARED TRAINING LOG";
  }
}

async function persistState() {
  if (!logState.data) return;
  if (!logState.isShared) {
    TrackerData.save(logState.data);
    return;
  }
  try {
    logState.saving = true;
    const response = await fetch(`/api/plans/share/${encodeURIComponent(logState.shareToken)}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments: logState.data.assignments, logs: logState.data.logs })
    });
    if (!response.ok) throw new Error("The shared log could not be saved.");
  } catch (error) {
    showLogToast(error.message);
  } finally {
    logState.saving = false;
  }
}

function currentAssignment() {
  if (!logState.data) return null;
  const byId = logState.data.assignments.find(assignment => assignment.id === logState.selectedAssignmentId);
  if (byId) return byId;
  const selected = TrackerData.assignmentForDate(logState.data, logState.selectedDate);
  if (selected) return selected;
  return logState.data.assignments.find(assignment => assignment.status === "planned" && assignment.date >= TrackerData.todayISO()) || null;
}

function workoutTitle(assignment) {
  return assignment?.workout?.name || "Training session";
}

function activitySummary(activity) {
  const target = TrackerData.targetLabel(activity);
  const intensity = TrackerData.intensityLabel(activity);
  if (activity.activityType === "run") return `${target}${intensity}`;
  return `${activity.sets} × ${target}${intensity}`;
}

function workoutTarget(workout) {
  return workout.exercises.map(activity => `${activity.name} · ${activitySummary(activity)}`).join(" · ");
}

function totalPlanned(workout) {
  return workout.exercises.reduce((total, activity) => total + Number(activity.targetValue || activity.reps || 0) * Number(activity.sets || 1), 0);
}

function totalCompleted(exercises) {
  return exercises.reduce((total, activity) => total + activity.sets.reduce((sum, set) => sum + Number(set.completed || 0), 0), 0);
}

function intensityOptions(selected = "") {
  return [
    ["", "Not recorded"],
    ["Easy", "Easy"],
    ["Steady", "Steady"],
    ["Moderate", "Moderate"],
    ["Tempo", "Tempo"],
    ["Intervals", "Intervals"],
    ["Hard", "Hard"]
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function renderGoal() {
  if (!logState.data) return;
  const published = logState.data.publishedProgram;
  const activeDays = published?.days.filter(day => day.enabled && day.exercises.length) || [];
  setLogText("goalHeading", logState.data.publishedGoal || logState.data.goal);
  setLogText("goalText", published
    ? `${activeDays.length} planned workout ${activeDays.length === 1 ? "day" : "days"} this week. Recommended days are a starting point, not a pass/fail test.`
    : "The owner has not published a program yet.");
  setLogText("publishedHeading", published?.name || "No program published yet");
  setLogText("publishedSummary", published?.description || "The owner can create a week with different workouts for different days.");
  setLogText("publishedVersion", published ? `Version ${published.version} · published plan` : "Waiting for a plan");
  setLogText("publishedStatus", published ? `Published v${published.version}` : "No plan yet");
}

function renderToday() {
  if (!logState.data) return;
  const assignment = currentAssignment();
  if (assignment) logState.selectedDate = assignment.date;
  const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
  const date = assignment?.date || logState.selectedDate;
  setLogText("todayDate", TrackerData.formatLongDate(date));
  setLogText("todayHeading", assignment ? (date === TrackerData.todayISO() ? "Today's assignment" : "Selected assignment") : "No assignment selected");
  setLogText("todaySubtitle", assignment
    ? (assignment.moved ? `Moved from ${TrackerData.formatShortDate(assignment.recommendedDate)} so it fits your week.` : "This workout was recommended for this day.")
    : "Open the plan workspace when you are ready to create a program.");
  const statusElement = document.getElementById("todayStatus");
  statusElement.className = "status-pill";
  if (log || assignment?.status === "completed") {
    statusElement.classList.add("status-completed");
    statusElement.textContent = "Completed";
  } else if (assignment?.status === "skipped") {
    statusElement.classList.add("status-skipped");
    statusElement.textContent = "Skipped";
  } else if (assignment?.moved) {
    statusElement.classList.add("status-moved");
    statusElement.textContent = "Moved";
  } else {
    statusElement.classList.add("status-recommended");
    statusElement.textContent = "Recommended";
  }

  const preview = document.getElementById("assignmentPreview");
  preview.innerHTML = assignment
    ? `<div class="assignment-main-chip"><strong>${escapeLogHtml(workoutTitle(assignment))}</strong><span>${escapeLogHtml(workoutTarget(assignment.workout))}</span></div>`
    : `<div class="empty-history">Nothing planned here yet.</div>`;
  const logButton = document.getElementById("logAssignmentBtn");
  const skipButton = document.getElementById("skipAssignmentBtn");
  logButton.disabled = !assignment || Boolean(log);
  logButton.textContent = log ? "Session logged ✓" : "Log this session";
  skipButton.disabled = !assignment || Boolean(log);
  logState.selectedAssignmentId = assignment?.id || null;
}

function renderWeek() {
  if (!logState.data) return;
  const weekStart = TrackerData.addDays(TrackerData.startOfWeek(TrackerData.todayISO()), logState.weekOffset * 7);
  const weekEnd = TrackerData.addDays(weekStart, 6);
  setLogText("weekLabel", logState.weekOffset === 0 ? "This week" : TrackerData.formatDateRange(weekStart, weekEnd));
  document.getElementById("dayGrid").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = TrackerData.addDays(weekStart, index);
    const assignment = TrackerData.assignmentForDate(logState.data, date);
    const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
    const dateObject = TrackerData.fromISO(date);
    const isSelected = logState.selectedDate === date;
    const classes = ["day-tile"];
    if (date === TrackerData.todayISO()) classes.push("is-today");
    if (date < TrackerData.todayISO()) classes.push("is-past");
    if (isSelected) classes.push("selected");
    if (log || assignment?.status === "completed") classes.push("is-completed");
    else if (assignment?.moved) classes.push("is-moved");
    else if (!assignment) classes.push("is-open");
    const marker = log || assignment?.status === "completed"
      ? `<span class="day-marker complete">✓</span>`
      : assignment?.moved ? `<span class="day-marker moved"></span>` : assignment ? `<span class="day-marker"></span>` : "";
    const content = assignment
      ? `<strong>${escapeLogHtml(workoutTitle(assignment))}</strong><span>${assignment.workout.exercises.length} activit${assignment.workout.exercises.length === 1 ? "y" : "ies"}</span>`
      : `<span>Rest / open day</span>`;
    const footer = assignment && !log && !assignment.moved ? `<span class="day-recommendation">recommended</span>` : "";
    return `<button class="${classes.join(" ")}" type="button" role="listitem" data-date="${date}" aria-label="${TrackerData.formatLongDate(date)}${assignment ? ", assignment" : ", rest or open day"}">
      ${marker}<span class="day-label">${TrackerData.DAY_NAMES[dateObject.getDay()]}</span><span class="day-number">${dateObject.getDate()}</span>
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
  const assignments = weekAssignments();
  const completed = assignments.filter(assignment => Boolean(TrackerData.logForAssignment(logState.data, assignment.id))).length;
  const activeDays = logState.data.publishedProgram?.days.filter(day => day.enabled && day.exercises.length).length || 0;
  const plannedCount = Math.max(assignments.length, activeDays);
  const rate = plannedCount ? Math.round((completed / plannedCount) * 100) : 0;
  setLogText("weekCompletion", `${completed}/${plannedCount}`);
  document.getElementById("weekProgressBar").style.width = `${Math.min(100, rate)}%`;
  const recentLogs = logState.data.logs.filter(log => {
    const age = TrackerData.daysBetween(log.date, TrackerData.todayISO());
    return age >= 0 && age <= 13;
  });
  setLogText("completedCount", recentLogs.length);
  setLogText("completionRate", `${rate}%`);
  const difficultyValues = recentLogs.map(log => Number(log.difficulty)).filter(Boolean);
  setLogText("averageDifficulty", difficultyValues.length ? (difficultyValues.reduce((sum, value) => sum + value, 0) / difficultyValues.length).toFixed(1) : "—");
}

function renderChart() {
  if (!logState.data) return;
  const chart = document.getElementById("progressChart");
  const start = TrackerData.addDays(TrackerData.todayISO(), -13);
  const values = Array.from({ length: 14 }, (_, index) => {
    const date = TrackerData.addDays(start, index);
    const assignment = TrackerData.assignmentForDate(logState.data, date);
    const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
    const target = assignment ? totalPlanned(assignment.workout) : 0;
    const actual = log ? totalCompleted(log.exercises) : 0;
    return { date, assignment, log, target, actual };
  });
  chart.innerHTML = values.map(value => {
    const ratio = value.target ? Math.min(100, Math.round((value.actual / value.target) * 100)) : 0;
    return `<div class="chart-column ${value.assignment && !value.log ? "planned" : ""}" title="${TrackerData.formatShortDate(value.date)}${value.log ? `: ${ratio}% completed` : value.assignment ? ": planned" : ": open"}">
      <span class="chart-track"></span><span class="chart-bar" style="height:${value.log ? Math.max(5, ratio) : 0}%"></span><span class="chart-label">${TrackerData.fromISO(value.date).getDate()}</span>
    </div>`;
  }).join("");
  setLogText("chartStart", TrackerData.formatShortDate(start));
  setLogText("chartEnd", TrackerData.formatShortDate(TrackerData.todayISO()));
  setLogText("chartNote", values.some(value => value.log) ? "Green bars show completed work against the target." : "Log sessions to see actual work compared with planned work.");
}

function renderHistory() {
  if (!logState.data) return;
  const list = document.getElementById("historyList");
  const logs = [...logState.data.logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  if (!logs.length) {
    list.innerHTML = `<div class="empty-history">No sessions logged yet.<br />Your history will appear here.</div>`;
    return;
  }
  list.innerHTML = logs.map(log => {
    const assignment = logState.data.assignments.find(item => item.id === log.assignmentId);
    const completed = totalCompleted(log.exercises);
    const planned = log.exercises.reduce((total, activity) => total + activity.sets.reduce((sum, set) => sum + Number(set.planned || 0), 0), 0);
    return `<div class="history-item"><span class="history-check">✓</span><div class="history-details">
      <span class="history-title">${escapeLogHtml(workoutTitle(assignment) || log.workoutName || "Training session")}</span>
      <span class="history-meta">${TrackerData.formatLongDate(log.date)}${log.difficulty ? ` · Difficulty ${log.difficulty}/10` : ""}</span>
    </div><span class="history-value">${TrackerData.targetLabel({ targetValue: completed, targetUnit: "reps" })}/${TrackerData.targetLabel({ targetValue: planned, targetUnit: "reps" })}</span></div>`;
  }).join("");
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
  const current = currentAssignment();
  if (!current) {
    showLogToast("There is no unfinished workout to move.");
    return;
  }
  if (TrackerData.logForAssignment(logState.data, current.id)) {
    showLogToast("That session is already logged.");
    return;
  }
  const existing = TrackerData.assignmentForDate(logState.data, targetDate);
  if (existing && existing.id !== current.id) {
    logState.selectedDate = targetDate;
    logState.selectedAssignmentId = existing.id;
    showLogToast("That day already has a workout. It is selected instead.");
    renderAllLog();
    return;
  }
  const oldDate = current.date;
  current.date = targetDate;
  current.moved = current.recommendedDate !== targetDate;
  logState.selectedDate = targetDate;
  logState.selectedAssignmentId = current.id;
  logState.data.assignments.sort((a, b) => a.date.localeCompare(b.date));
  persistState();
  showLogToast(oldDate === targetDate ? "Workout selected." : `Moved from ${TrackerData.formatShortDate(oldDate)} to ${TrackerData.formatShortDate(targetDate)}.`);
  renderAllLog();
}

function openLogModal() {
  const assignment = currentAssignment();
  if (!assignment || TrackerData.logForAssignment(logState.data, assignment.id)) return;
  logState.editingAssignmentId = assignment.id;
  setLogText("logModalTitle", `Log ${workoutTitle(assignment)}`);
  setLogText("logModalContext", assignment.moved
    ? `Recommended for ${TrackerData.formatShortDate(assignment.recommendedDate)}, moved to ${TrackerData.formatShortDate(assignment.date)}. Partial work is useful data too.`
    : "Record what you actually completed. For runs, record the distance you actually covered and how it felt.");
  document.getElementById("logExerciseFields").innerHTML = assignment.workout.exercises.map((activity, activityIndex) => `
    <div class="log-exercise">
      <div class="log-exercise-heading"><h3>${escapeLogHtml(activity.name)}</h3><span>${escapeLogHtml(activitySummary(activity))}</span></div>
      ${Array.from({ length: activity.sets }, (_, setIndex) => `<div class="set-row">
        <span>${activity.activityType === "run" ? "Distance" : `Set ${setIndex + 1}`}</span>
        <label><span class="sr-only">Planned target</span><input value="${escapeLogHtml(TrackerData.targetLabel(activity))}" disabled /></label>
        <label><span class="sr-only">Completed target</span><input type="number" min="0" step="${activity.activityType === "run" || activity.targetUnit !== "reps" ? "0.1" : "1"}" value="${activity.targetValue}" data-completed-activity="${activityIndex}" data-completed-set="${setIndex}" /></label>
      </div>`).join("")}
      <label class="actual-intensity"><span>Actual intensity <em>(optional)</em></span><select data-actual-intensity="${activityIndex}">${intensityOptions(activity.intensity)}</select></label>
    </div>`).join("");
  document.getElementById("difficulty").value = "";
  document.getElementById("energy").value = "";
  document.getElementById("sessionNote").value = "";
  document.getElementById("logModal").hidden = false;
}

function saveLog(event) {
  event.preventDefault();
  const assignment = logState.data.assignments.find(item => item.id === logState.editingAssignmentId);
  if (!assignment) return;
  const exercises = assignment.workout.exercises.map((activity, activityIndex) => ({
    ...activity,
    sets: Array.from({ length: activity.sets }, (_, setIndex) => ({
      planned: activity.targetValue,
      completed: Math.max(0, Number(document.querySelector(`[data-completed-activity="${activityIndex}"][data-completed-set="${setIndex}"]`).value) || 0),
      intensity: document.querySelector(`[data-actual-intensity="${activityIndex}"]`)?.value || activity.intensity || ""
    }))
  }));
  logState.data.logs = logState.data.logs.filter(item => item.assignmentId !== assignment.id);
  logState.data.logs.push({
    id: `log-${Date.now()}`,
    assignmentId: assignment.id,
    workoutName: assignment.workout.name,
    date: assignment.date,
    exercises,
    difficulty: document.getElementById("difficulty").value,
    energy: document.getElementById("energy").value,
    note: document.getElementById("sessionNote").value.trim(),
    createdAt: new Date().toISOString()
  });
  assignment.status = "completed";
  persistState();
  document.getElementById("logModal").hidden = true;
  showLogToast("Session saved. Nice work.");
  renderAllLog();
}

function skipAssignment() {
  const assignment = currentAssignment();
  if (!assignment || TrackerData.logForAssignment(logState.data, assignment.id)) return;
  assignment.status = assignment.status === "skipped" ? "planned" : "skipped";
  persistState();
  showLogToast(assignment.status === "skipped" ? "Marked as skipped. You can still log it later." : "Workout reopened.");
  renderAllLog();
}

function exportCsv() {
  const rows = [["date", "recommended_date", "status", "workout", "activity", "set", "planned_target", "completed_target", "unit", "planned_intensity", "actual_intensity", "difficulty", "energy", "note"]];
  logState.data.assignments.forEach(assignment => {
    const log = TrackerData.logForAssignment(logState.data, assignment.id);
    if (!log) {
      assignment.workout.exercises.forEach(activity => {
        for (let set = 1; set <= activity.sets; set += 1) rows.push([assignment.date, assignment.recommendedDate, assignment.status, assignment.workout.name, activity.name, set, activity.targetValue, "", activity.targetUnit, activity.intensity, "", "", "", ""]);
      });
      return;
    }
    log.exercises.forEach(activity => activity.sets.forEach((set, index) => rows.push([log.date, assignment.recommendedDate, "completed", assignment.workout.name, activity.name, index + 1, set.planned, set.completed, activity.targetUnit, activity.intensity, set.intensity, log.difficulty, log.energy, log.note])));
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
  if (logState.isShared) return;
  if (!logState.data.logs.length || !window.confirm("Clear all logged sessions? Your program and assignments will remain.")) return;
  logState.data.logs = [];
  logState.data.assignments.forEach(assignment => {
    if (assignment.status === "completed") assignment.status = "planned";
  });
  persistState();
  showLogToast("Session logs cleared.");
  renderAllLog();
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
      showLogToast(TrackerData.logForAssignment(logState.data, assignment.id) ? "Completed session selected." : "Workout selected.");
      renderAllLog();
    } else {
      moveSelectedAssignment(date);
    }
  });
  document.getElementById("logAssignmentBtn").addEventListener("click", openLogModal);
  document.getElementById("skipAssignmentBtn").addEventListener("click", skipAssignment);
  document.getElementById("previousWeekBtn").addEventListener("click", () => { logState.weekOffset -= 1; renderWeek(); });
  document.getElementById("nextWeekBtn").addEventListener("click", () => { logState.weekOffset += 1; renderWeek(); });
  document.getElementById("exportBtn").addEventListener("click", exportCsv);
  document.getElementById("clearLogsBtn").addEventListener("click", clearLogs);
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
      TrackerData.ensureAssignments(logState.data);
      renderAllLog();
      persistState();
    } catch (error) {
      showLogToast(error.message);
      setLogText("todayHeading", "Shared plan unavailable");
      setLogText("todaySubtitle", "Ask the owner for a new link.");
    }
    return;
  }
  logState.data = TrackerData.load();
  TrackerData.ensureAssignments(logState.data);
  TrackerData.save(logState.data);
  renderAllLog();
}

bootstrapLog();