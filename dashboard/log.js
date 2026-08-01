const logState = {
  data: TrackerData.load(),
  selectedDate: TrackerData.todayISO(),
  selectedAssignmentId: null,
  editingAssignmentId: null,
  weekOffset: 0,
  toastTimer: null
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
  logState.toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function currentAssignment() {
  const byId = logState.data.assignments.find(assignment => assignment.id === logState.selectedAssignmentId);
  if (byId) return byId;
  const selected = TrackerData.assignmentForDate(logState.data, logState.selectedDate);
  if (selected) return selected;
  return logState.data.assignments.find(assignment => assignment.status === "planned" && assignment.date >= TrackerData.todayISO()) || null;
}

function workoutTitle(assignment) {
  return assignment?.workout?.name || "Training session";
}

function workoutTarget(workout) {
  return workout.exercises.map(exercise => `${exercise.name} · ${exercise.sets} × ${exercise.reps}${exercise.unit === "reps" ? "" : ` ${exercise.unit}`}`).join(" · ");
}

function renderGoal() {
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
  const weekStart = TrackerData.addDays(TrackerData.startOfWeek(TrackerData.todayISO()), logState.weekOffset * 7);
  const weekEnd = TrackerData.addDays(weekStart, 6);
  setLogText("weekLabel", logState.weekOffset === 0 ? "This week" : TrackerData.formatDateRange(weekStart, weekEnd));
  document.getElementById("dayGrid").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = TrackerData.addDays(weekStart, index);
    const assignment = TrackerData.assignmentForDate(logState.data, date);
    const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
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
      ? `<strong>${escapeLogHtml(workoutTitle(assignment))}</strong><span>${assignment.workout.exercises.length} exercise${assignment.workout.exercises.length === 1 ? "" : "s"}</span>`
      : `<span>Open day</span>`;
    const footer = assignment && !log && !assignment.moved ? `<span class="day-recommendation">recommended</span>` : "";
    return `<button class="${classes.join(" ")}" type="button" role="listitem" data-date="${date}" aria-label="${TrackerData.formatLongDate(date)}${assignment ? ", assignment" : ", open day"}">
      ${marker}<span class="day-label">${TrackerData.DAY_NAMES[fromDate(date).getDay()]}</span><span class="day-number">${fromDate(date).getDate()}</span>
      <span class="day-content">${content}</span>${footer}</button>`;
  }).join("");
}

function fromDate(value) {
  return TrackerData.fromISO(value);
}

function weekAssignments() {
  const start = TrackerData.startOfWeek(TrackerData.todayISO());
  const end = TrackerData.addDays(start, 6);
  return logState.data.assignments.filter(assignment => assignment.date >= start && assignment.date <= end);
}

function renderStats() {
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
  const chart = document.getElementById("progressChart");
  const start = TrackerData.addDays(TrackerData.todayISO(), -13);
  const values = Array.from({ length: 14 }, (_, index) => {
    const date = TrackerData.addDays(start, index);
    const assignment = TrackerData.assignmentForDate(logState.data, date);
    const log = assignment ? TrackerData.logForAssignment(logState.data, assignment.id) : null;
    const target = assignment ? assignment.workout.exercises.reduce((total, exercise) => total + exercise.sets * exercise.reps, 0) : 0;
    const actual = log ? log.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) => sum + Number(set.completed || 0), 0), 0) : 0;
    return { date, assignment, log, target, actual };
  });
  chart.innerHTML = values.map(value => {
    const ratio = value.target ? Math.min(100, Math.round((value.actual / value.target) * 100)) : 0;
    return `<div class="chart-column ${value.assignment && !value.log ? "planned" : ""}" title="${TrackerData.formatShortDate(value.date)}${value.log ? `: ${ratio}% completed` : value.assignment ? ": planned" : ": open"}">
      <span class="chart-track"></span><span class="chart-bar" style="height:${value.log ? Math.max(5, ratio) : 0}%"></span><span class="chart-label">${fromDate(value.date).getDate()}</span>
    </div>`;
  }).join("");
  setLogText("chartStart", TrackerData.formatShortDate(start));
  setLogText("chartEnd", TrackerData.formatShortDate(TrackerData.todayISO()));
  setLogText("chartNote", values.some(value => value.log) ? "Green bars show completed work against the target." : "Log sessions to see actual work compared with planned work.");
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const logs = [...logState.data.logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  if (!logs.length) {
    list.innerHTML = `<div class="empty-history">No sessions logged yet.<br />Your history will appear here.</div>`;
    return;
  }
  list.innerHTML = logs.map(log => {
    const assignment = logState.data.assignments.find(item => item.id === log.assignmentId);
    const completed = log.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) => sum + Number(set.completed || 0), 0), 0);
    const planned = log.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) => sum + Number(set.planned || 0), 0), 0);
    return `<div class="history-item"><span class="history-check">✓</span><div class="history-details">
      <span class="history-title">${escapeLogHtml(workoutTitle(assignment))}</span>
      <span class="history-meta">${TrackerData.formatLongDate(log.date)}${log.difficulty ? ` · Difficulty ${log.difficulty}/10` : ""}</span>
    </div><span class="history-value">${completed}/${planned}</span></div>`;
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
  TrackerData.save(logState.data);
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
    : "Record what you actually completed. Partial work is useful data too.");
  document.getElementById("logExerciseFields").innerHTML = assignment.workout.exercises.map((exercise, exerciseIndex) => `
    <div class="log-exercise"><h3>${escapeLogHtml(exercise.name)}</h3>
      ${Array.from({ length: exercise.sets }, (_, setIndex) => `<div class="set-row"><span>Set ${setIndex + 1}</span>
        <label><span class="sr-only">Planned target</span><input value="${exercise.reps} ${exercise.unit === "reps" ? "reps" : exercise.unit}" disabled /></label>
        <label><span class="sr-only">Completed target</span><input type="number" min="0" value="${exercise.reps}" data-completed-exercise="${exerciseIndex}" data-completed-set="${setIndex}" /></label>
      </div>`).join("")}
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
  const exercises = assignment.workout.exercises.map((exercise, exerciseIndex) => ({
    ...exercise,
    sets: Array.from({ length: exercise.sets }, (_, setIndex) => ({
      planned: exercise.reps,
      completed: Math.max(0, Number(document.querySelector(`[data-completed-exercise="${exerciseIndex}"][data-completed-set="${setIndex}"]`).value) || 0)
    }))
  }));
  logState.data.logs = logState.data.logs.filter(item => item.assignmentId !== assignment.id);
  logState.data.logs.push({
    id: `log-${Date.now()}`,
    assignmentId: assignment.id,
    date: assignment.date,
    exercises,
    difficulty: document.getElementById("difficulty").value,
    energy: document.getElementById("energy").value,
    note: document.getElementById("sessionNote").value.trim(),
    createdAt: new Date().toISOString()
  });
  assignment.status = "completed";
  TrackerData.save(logState.data);
  document.getElementById("logModal").hidden = true;
  showLogToast("Session saved. Nice work.");
  renderAllLog();
}

function skipAssignment() {
  const assignment = currentAssignment();
  if (!assignment || TrackerData.logForAssignment(logState.data, assignment.id)) return;
  assignment.status = assignment.status === "skipped" ? "planned" : "skipped";
  TrackerData.save(logState.data);
  showLogToast(assignment.status === "skipped" ? "Marked as skipped. You can still log it later." : "Workout reopened.");
  renderAllLog();
}

function exportCsv() {
  const rows = [["date", "recommended_date", "status", "workout", "exercise", "set", "planned_target", "completed_target", "unit", "difficulty", "energy", "note"]];
  logState.data.assignments.forEach(assignment => {
    const log = TrackerData.logForAssignment(logState.data, assignment.id);
    if (!log) {
      assignment.workout.exercises.forEach(exercise => {
        for (let set = 1; set <= exercise.sets; set += 1) rows.push([assignment.date, assignment.recommendedDate, assignment.status, assignment.workout.name, exercise.name, set, exercise.reps, "", exercise.unit, "", "", ""]);
      });
      return;
    }
    log.exercises.forEach(exercise => exercise.sets.forEach((set, index) => rows.push([log.date, assignment.recommendedDate, "completed", assignment.workout.name, exercise.name, index + 1, set.planned, set.completed, exercise.unit, log.difficulty, log.energy, log.note])));
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
  if (!logState.data.logs.length || !window.confirm("Clear all logged sessions? Your program and assignments will remain.")) return;
  logState.data.logs = [];
  logState.data.assignments.forEach(assignment => {
    if (assignment.status === "completed") assignment.status = "planned";
  });
  TrackerData.save(logState.data);
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

TrackerData.ensureAssignments(logState.data);
TrackerData.save(logState.data);
bindLogEvents();
renderAllLog();