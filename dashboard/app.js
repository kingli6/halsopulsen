const STORAGE_KEY = "halsopulsen.personal-tracker.v1";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const state = {
  data: loadData(),
  selectedDate: todayISO(),
  weekOffset: 0,
  selectedAssignmentId: null,
  editingAssignmentId: null,
  toastTimer: null
};

function todayISO() {
  return toISO(new Date());
}

function toISO(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${MONTH_NAMES[a.getMonth()]}`;
  }
  return `${a.getDate()} ${MONTH_NAMES[a.getMonth()]}–${b.getDate()} ${MONTH_NAMES[b.getMonth()]}`;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultData() {
  return {
    person: { name: "My dashboard" },
    goal: "Build a consistent squat habit",
    program: {
      name: "Squat habit",
      description: "Three sets with a long break between each set.",
      recommendedDays: [1, 3, 5, 0],
      exercises: [
        { name: "Bodyweight squats", sets: 3, reps: 12, restSeconds: 180 }
      ],
      version: 1
    },
    assignments: [],
    logs: []
  };
}

function loadData() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.program && Array.isArray(stored.assignments) && Array.isArray(stored.logs)) {
      return stored;
    }
  } catch (error) {
    console.warn("Could not load tracker data", error);
  }
  return defaultData();
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function assignmentId(date) {
  return `assignment-${date}`;
}

function ensureAssignments() {
  const program = state.data.program;
  const start = addDays(todayISO(), -35);
  const end = addDays(todayISO(), 56);
  const existingDates = new Set(state.data.assignments.map(assignment => assignment.date));
  const assignments = [...state.data.assignments];

  for (let i = 0; i <= daysBetween(start, end); i += 1) {
    const date = addDays(start, i);
    const weekday = fromISO(date).getDay();
    if (!program.recommendedDays.includes(weekday) || existingDates.has(date)) continue;
    assignments.push({
      id: assignmentId(date),
      date,
      recommendedDate: date,
      status: "planned",
      exercises: deepCopy(program.exercises),
      moved: false
    });
    existingDates.add(date);
  }

  state.data.assignments = assignments.sort((a, b) => a.date.localeCompare(b.date));
  saveData();
}

function assignmentForDate(date) {
  return state.data.assignments.find(assignment => assignment.date === date) || null;
}

function logForAssignment(id) {
  return state.data.logs.find(log => log.assignmentId === id) || null;
}

function getSelectedAssignment() {
  const byId = state.data.assignments.find(assignment => assignment.id === state.selectedAssignmentId);
  if (byId) return byId;
  const selected = assignmentForDate(state.selectedDate);
  if (selected) return selected;
  return state.data.assignments.find(assignment => assignment.status === "planned" && assignment.date >= todayISO()) || null;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function renderGoal() {
  const program = state.data.program;
  setText("goalHeading", state.data.goal);
  setText("goalText", `Complete ${program.recommendedDays.length || "a few"} flexible sessions each week. Recommended days are a starting point, not a pass/fail test.`);
  setText("programHeading", program.name);
  setText("programSummary", program.description || "A flexible training plan built around your goal.");
  setText("recommendedDaysText", program.recommendedDays.map(day => DAY_NAMES[day]).join(" · ") || "No fixed days");
  document.getElementById("exerciseChips").innerHTML = program.exercises
    .map(exercise => `<span class="exercise-chip">${escapeHtml(exercise.name)} · ${exercise.sets} × ${exercise.reps}</span>`)
    .join("");
}

function renderToday() {
  const assignment = getSelectedAssignment();
  const targetDate = assignment?.date || state.selectedDate;
  if (assignment) {
    state.selectedDate = targetDate;
  }
  const log = assignment ? logForAssignment(assignment.id) : null;
  setText("todayDate", formatLongDate(targetDate));
  setText("todayHeading", assignment ? (targetDate === todayISO() ? "Today's assignment" : "Selected assignment") : "No assignment selected");
  setText("todaySubtitle", assignment
    ? (assignment.moved ? `Moved from ${formatShortDate(assignment.recommendedDate)} so it fits your week.` : "This is a recommendation. Move it whenever life gets in the way.")
    : "Edit your program to add recommended training days.");

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
  if (!assignment) {
    preview.innerHTML = `<div class="empty-history">Nothing planned here yet.</div>`;
  } else {
    preview.innerHTML = assignment.exercises.map(exercise => `
      <div class="preview-chip">
        <strong>${escapeHtml(exercise.name)}</strong>
        <span>${exercise.sets} sets × ${exercise.reps} reps · ${formatRest(exercise.restSeconds)} rest</span>
      </div>
    `).join("");
  }

  const logButton = document.getElementById("logAssignmentBtn");
  const skipButton = document.getElementById("skipAssignmentBtn");
  logButton.disabled = !assignment || Boolean(log);
  logButton.textContent = log ? "Session logged ✓" : "Log this session";
  skipButton.disabled = !assignment || Boolean(log);
  state.selectedAssignmentId = assignment?.id || null;
}

function formatRest(seconds) {
  if (!seconds) return "flexible";
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} sec`;
}

function renderWeek() {
  const weekStart = addDays(startOfWeek(todayISO()), state.weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);
  setText("weekLabel", state.weekOffset === 0 ? "This week" : formatDateRange(weekStart, weekEnd));
  document.getElementById("dayGrid").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const assignment = assignmentForDate(date);
    const log = assignment ? logForAssignment(assignment.id) : null;
    const isToday = date === todayISO();
    const isPast = date < todayISO();
    const isSelected = state.selectedDate === date;
    const classNames = ["day-tile"];
    if (isToday) classNames.push("is-today");
    if (isPast) classNames.push("is-past");
    if (isSelected) classNames.push("selected");
    if (log || assignment?.status === "completed") classNames.push("is-completed");
    else if (assignment?.moved) classNames.push("is-moved");
    else if (!assignment) classNames.push("is-open");
    const weekday = fromISO(date).getDay();
    const marker = log || assignment?.status === "completed"
      ? `<span class="day-marker complete">✓</span>`
      : assignment?.moved
        ? `<span class="day-marker moved"></span>`
        : assignment
          ? `<span class="day-marker"></span>`
          : "";
    const content = assignment
      ? `<strong>${assignment.exercises[0]?.name || "Session"}</strong>${assignment.exercises.length > 1 ? `+ ${assignment.exercises.length - 1} more` : "planned"}`
      : `<span>Open day</span>`;
    const footer = assignment && !log && !assignment.moved ? `<span class="day-recommendation">recommended</span>` : "";
    return `
      <button class="${classNames.join(" ")}" type="button" role="listitem" data-date="${date}" aria-label="${formatLongDate(date)}${assignment ? ", assignment" : ", open day"}">
        ${marker}
        <span class="day-label">${DAY_NAMES[weekday]}</span>
        <span class="day-number">${fromISO(date).getDate()}</span>
        <span class="day-content">${content}</span>
        ${footer}
      </button>
    `;
  }).join("");
}

function weekAssignments() {
  const start = startOfWeek(todayISO());
  const end = addDays(start, 6);
  return state.data.assignments.filter(assignment => assignment.date >= start && assignment.date <= end);
}

function renderStats() {
  const assignments = weekAssignments();
  const completed = assignments.filter(assignment => Boolean(logForAssignment(assignment.id))).length;
  const plannedCount = Math.max(assignments.length, state.data.program.recommendedDays.length);
  const rate = plannedCount ? Math.round((completed / plannedCount) * 100) : 0;
  setText("weekCompletion", `${completed}/${plannedCount}`);
  document.getElementById("weekProgressBar").style.width = `${Math.min(100, rate)}%`;
  const recentLogs = state.data.logs.filter(log => daysBetween(log.date, todayISO()) >= 0 && daysBetween(log.date, todayISO()) <= 13);
  setText("completedCount", recentLogs.length);
  setText("completionRate", `${rate}%`);
  const difficultyValues = recentLogs.map(log => Number(log.difficulty)).filter(Boolean);
  setText("averageDifficulty", difficultyValues.length
    ? (difficultyValues.reduce((sum, value) => sum + value, 0) / difficultyValues.length).toFixed(1)
    : "—");
}

function renderChart() {
  const chart = document.getElementById("progressChart");
  const start = addDays(todayISO(), -13);
  const values = Array.from({ length: 14 }, (_, index) => {
    const date = addDays(start, index);
    const assignment = assignmentForDate(date);
    const log = assignment ? logForAssignment(assignment.id) : null;
    const target = assignment ? assignment.exercises.reduce((total, exercise) => total + exercise.sets * exercise.reps, 0) : 0;
    const actual = log ? log.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) => sum + Number(set.completed || 0), 0), 0) : 0;
    return { date, assignment, log, target, actual };
  });
  chart.innerHTML = values.map(value => {
    const ratio = value.target ? Math.min(100, Math.round((value.actual / value.target) * 100)) : 0;
    const planned = value.assignment && !value.log;
    return `
      <div class="chart-column ${planned ? "planned" : ""}" title="${formatShortDate(value.date)}${value.log ? `: ${ratio}% completed` : value.assignment ? ": planned" : ": open"}">
        <span class="chart-track"></span>
        <span class="chart-bar" style="height:${value.log ? Math.max(5, ratio) : 0}%"></span>
        <span class="chart-label">${fromISO(value.date).getDate()}</span>
      </div>
    `;
  }).join("");
  setText("chartStart", formatShortDate(start));
  setText("chartEnd", formatShortDate(todayISO()));
  const logged = values.filter(value => value.log).length;
  setText("chartNote", logged
    ? "Green bars show completed work against the target for each session."
    : "Log sessions to see actual work compared with your planned days.");
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const logs = [...state.data.logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  if (!logs.length) {
    list.innerHTML = `<div class="empty-history">No sessions logged yet.<br />Your history will appear here.</div>`;
    return;
  }
  list.innerHTML = logs.map(log => {
    const assignment = state.data.assignments.find(item => item.id === log.assignmentId);
    const completed = log.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) => sum + Number(set.completed || 0), 0), 0);
    const planned = log.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) => sum + Number(set.planned || 0), 0), 0);
    return `
      <div class="history-item">
        <span class="history-check">✓</span>
        <div class="history-details">
          <span class="history-title">${escapeHtml(assignment?.exercises[0]?.name || "Training session")}</span>
          <span class="history-meta">${formatLongDate(log.date)}${log.difficulty ? ` · Difficulty ${log.difficulty}/10` : ""}</span>
        </div>
        <span class="history-value">${completed}/${planned}</span>
      </div>
    `;
  }).join("");
}

function renderAll() {
  renderGoal();
  renderToday();
  renderWeek();
  renderStats();
  renderChart();
  renderHistory();
}

function moveSelectedAssignment(targetDate) {
  const current = getSelectedAssignment();
  if (!current) {
    showToast("There is no unfinished assignment to move.");
    return;
  }
  if (logForAssignment(current.id)) {
    state.selectedDate = targetDate;
    showToast("That session is already logged.");
    renderAll();
    return;
  }
  const existing = assignmentForDate(targetDate);
  if (existing && existing.id !== current.id) {
    state.selectedDate = targetDate;
    state.selectedAssignmentId = existing.id;
    showToast("That day already has an assignment. It is selected instead.");
    renderAll();
    return;
  }
  const previousDate = current.date;
  current.date = targetDate;
  current.moved = current.recommendedDate !== targetDate;
  current.id = assignmentId(targetDate);
  state.selectedDate = targetDate;
  state.selectedAssignmentId = current.id;
  state.data.assignments.sort((a, b) => a.date.localeCompare(b.date));
  saveData();
  showToast(previousDate === targetDate ? "Assignment selected." : `Moved from ${formatShortDate(previousDate)} to ${formatShortDate(targetDate)}.`);
  renderAll();
}

function openLogModal() {
  const assignment = getSelectedAssignment();
  if (!assignment || logForAssignment(assignment.id)) return;
  state.editingAssignmentId = assignment.id;
  setText("logModalTitle", `Log ${formatShortDate(assignment.date)}`);
  setText("logModalContext", assignment.moved
    ? `This was recommended for ${formatShortDate(assignment.recommendedDate)}, and moved to fit your week.`
    : "Record what you actually completed. Partial work is useful data too.");
  document.getElementById("logExerciseFields").innerHTML = assignment.exercises.map((exercise, exerciseIndex) => `
    <div class="log-exercise">
      <h3>${escapeHtml(exercise.name)}</h3>
      ${Array.from({ length: exercise.sets }, (_, setIndex) => `
        <div class="set-row">
          <span>Set ${setIndex + 1}</span>
          <label><span class="sr-only">Planned reps</span><input type="number" min="0" value="${exercise.reps}" data-exercise="${exerciseIndex}" data-set="${setIndex}" data-planned="${exercise.reps}" disabled /></label>
          <label><span class="sr-only">Completed reps</span><input type="number" min="0" value="${exercise.reps}" data-completed-exercise="${exerciseIndex}" data-completed-set="${setIndex}" /></label>
        </div>
      `).join("")}
    </div>
  `).join("");
  document.querySelectorAll("#logExerciseFields .set-row").forEach(row => {
    row.children[1].querySelector("input").setAttribute("aria-label", "Planned reps");
    row.children[2].querySelector("input").setAttribute("aria-label", "Completed reps");
    row.children[1].querySelector("input").title = "Planned reps";
    row.children[2].querySelector("input").title = "Completed reps";
  });
  document.getElementById("difficulty").value = "";
  document.getElementById("energy").value = "";
  document.getElementById("sessionNote").value = "";
  document.getElementById("logModal").hidden = false;
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
}

function saveLog(event) {
  event.preventDefault();
  const assignment = state.data.assignments.find(item => item.id === state.editingAssignmentId);
  if (!assignment) return;
  const exercises = assignment.exercises.map((exercise, exerciseIndex) => ({
    ...exercise,
    sets: Array.from({ length: exercise.sets }, (_, setIndex) => ({
      planned: exercise.reps,
      completed: Math.max(0, Number(document.querySelector(`[data-completed-exercise="${exerciseIndex}"][data-completed-set="${setIndex}"]`).value) || 0)
    }))
  }));
  const log = {
    id: `log-${Date.now()}`,
    assignmentId: assignment.id,
    date: assignment.date,
    exercises,
    difficulty: document.getElementById("difficulty").value,
    energy: document.getElementById("energy").value,
    note: document.getElementById("sessionNote").value.trim(),
    createdAt: new Date().toISOString()
  };
  state.data.logs = state.data.logs.filter(item => item.assignmentId !== assignment.id);
  state.data.logs.push(log);
  assignment.status = "completed";
  saveData();
  closeModal("logModal");
  showToast("Session saved. Nice work.");
  renderAll();
}

function skipAssignment() {
  const assignment = getSelectedAssignment();
  if (!assignment || logForAssignment(assignment.id)) return;
  assignment.status = assignment.status === "skipped" ? "planned" : "skipped";
  saveData();
  showToast(assignment.status === "skipped" ? "Marked as skipped. You can still log it later." : "Assignment reopened.");
  renderAll();
}

function addExerciseRow(exercise = { name: "", sets: 3, reps: 10, restSeconds: 120 }) {
  const list = document.getElementById("exerciseEditorList");
  const row = document.createElement("div");
  row.className = "exercise-editor";
  row.innerHTML = `
    <label>Exercise<input data-field="name" required maxlength="60" value="${escapeHtml(exercise.name)}" placeholder="e.g. Squats" /></label>
    <label>Sets<input data-field="sets" type="number" min="1" max="20" value="${exercise.sets}" required /></label>
    <label>Reps<input data-field="reps" type="number" min="1" max="1000" value="${exercise.reps}" required /></label>
    <label>Rest (sec)<input data-field="restSeconds" type="number" min="0" max="3600" value="${exercise.restSeconds}" required /></label>
    <button class="remove-exercise" type="button" aria-label="Remove exercise">×</button>
  `;
  row.querySelector(".remove-exercise").addEventListener("click", () => {
    if (list.children.length === 1) {
      showToast("Keep at least one exercise in the program.");
      return;
    }
    row.remove();
  });
  list.appendChild(row);
}

function openProgramModal() {
  const program = state.data.program;
  document.getElementById("goalInput").value = state.data.goal;
  document.getElementById("programNameInput").value = program.name;
  document.getElementById("programDescriptionInput").value = program.description || "";
  document.getElementById("exerciseEditorList").innerHTML = "";
  program.exercises.forEach(addExerciseRow);
  document.querySelectorAll("#dayCheckboxes input").forEach(input => {
    input.checked = program.recommendedDays.includes(Number(input.value));
  });
  document.getElementById("programModal").hidden = false;
}

function saveProgram(event) {
  event.preventDefault();
  const exercises = [...document.querySelectorAll("#exerciseEditorList .exercise-editor")].map(row => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    sets: Number(row.querySelector('[data-field="sets"]').value),
    reps: Number(row.querySelector('[data-field="reps"]').value),
    restSeconds: Number(row.querySelector('[data-field="restSeconds"]').value)
  })).filter(exercise => exercise.name);
  const recommendedDays = [...document.querySelectorAll("#dayCheckboxes input:checked")].map(input => Number(input.value));
  if (!exercises.length || !recommendedDays.length) {
    showToast("Add an exercise and choose at least one recommended day.");
    return;
  }
  state.data.goal = document.getElementById("goalInput").value.trim();
  state.data.program = {
    ...state.data.program,
    name: document.getElementById("programNameInput").value.trim(),
    description: document.getElementById("programDescriptionInput").value.trim(),
    exercises,
    recommendedDays,
    version: (state.data.program.version || 1) + 1
  };
  state.data.assignments.filter(assignment => assignment.status === "planned" && !logForAssignment(assignment.id))
    .forEach(assignment => { assignment.exercises = deepCopy(exercises); });
  ensureAssignments();
  saveData();
  closeModal("programModal");
  showToast("Program saved. Future assignments use the new structure.");
  renderAll();
}

function exportCsv() {
  const rows = [["date", "recommended_date", "status", "exercise", "set", "planned_reps", "completed_reps", "difficulty", "energy", "note"]];
  state.data.assignments.forEach(assignment => {
    const log = logForAssignment(assignment.id);
    if (!log) {
      assignment.exercises.forEach(exercise => {
        for (let set = 1; set <= exercise.sets; set += 1) {
          rows.push([assignment.date, assignment.recommendedDate, assignment.status, exercise.name, set, exercise.reps, "", "", "", ""]);
        }
      });
      return;
    }
    log.exercises.forEach(exercise => {
      exercise.sets.forEach((set, index) => {
        rows.push([log.date, assignment.recommendedDate, "completed", exercise.name, index + 1, set.planned, set.completed, log.difficulty, log.energy, log.note]);
      });
    });
  });
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `halsopulsen-training-${todayISO()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("CSV exported. You can open it in Excel or upload it to an AI.");
}

async function copySummary() {
  const program = state.data.program;
  const logs = [...state.data.logs].sort((a, b) => a.date.localeCompare(b.date));
  const summary = [
    "Please analyse this personal training data and give practical, cautious feedback.",
    "",
    `Goal: ${state.data.goal}`,
    `Program: ${program.name}`,
    `Recommended days: ${program.recommendedDays.map(day => DAY_NAMES[day]).join(", ")}`,
    `Exercises: ${program.exercises.map(exercise => `${exercise.name} — ${exercise.sets} sets x ${exercise.reps} reps, ${formatRest(exercise.restSeconds)} rest`).join("; ")}`,
    "",
    "Date | Recommended date | Exercise | Completed vs planned | Difficulty | Energy | Note",
    ...logs.map(log => {
      const assignment = state.data.assignments.find(item => item.id === log.assignmentId);
      const totals = log.exercises.reduce((result, exercise) => {
        result.completed += exercise.sets.reduce((sum, set) => sum + Number(set.completed || 0), 0);
        result.planned += exercise.sets.reduce((sum, set) => sum + Number(set.planned || 0), 0);
        return result;
      }, { completed: 0, planned: 0 });
      return `${log.date} | ${assignment?.recommendedDate || log.date} | ${assignment?.exercises.map(exercise => exercise.name).join(" + ") || "Session"} | ${totals.completed}/${totals.planned} | ${log.difficulty || "-"} | ${log.energy || "-"} | ${log.note || "-"}`;
    }),
    "",
    "Please distinguish observations from assumptions, and suggest only small next steps. Do not diagnose injuries."
  ].join("\n");
  try {
    await navigator.clipboard.writeText(summary);
    showToast("AI-ready summary copied to your clipboard.");
  } catch (error) {
    showToast("Copy was blocked by the browser. Use Export CSV instead.");
  }
}

function clearLogs() {
  if (!state.data.logs.length) return;
  if (!window.confirm("Clear all logged sessions? Your program and assignments will remain.")) return;
  state.data.logs = [];
  state.data.assignments.forEach(assignment => {
    if (assignment.status === "completed") assignment.status = "planned";
  });
  saveData();
  showToast("Session logs cleared.");
  renderAll();
}

function bindEvents() {
  document.getElementById("dayGrid").addEventListener("click", event => {
    const tile = event.target.closest("[data-date]");
    if (!tile) return;
    const date = tile.dataset.date;
    const assignment = assignmentForDate(date);
    state.selectedDate = date;
    if (assignment) {
      state.selectedAssignmentId = assignment.id;
      showToast(logForAssignment(assignment.id) ? "Completed session selected." : "Assignment selected.");
      renderAll();
      return;
    }
    moveSelectedAssignment(date);
  });
  document.getElementById("logAssignmentBtn").addEventListener("click", openLogModal);
  document.getElementById("skipAssignmentBtn").addEventListener("click", skipAssignment);
  document.getElementById("previousWeekBtn").addEventListener("click", () => { state.weekOffset -= 1; renderWeek(); });
  document.getElementById("nextWeekBtn").addEventListener("click", () => { state.weekOffset += 1; renderWeek(); });
  document.getElementById("exportBtn").addEventListener("click", exportCsv);
  document.getElementById("copySummaryBtn").addEventListener("click", copySummary);
  document.getElementById("clearLogsBtn").addEventListener("click", clearLogs);
  document.getElementById("openProgramBtn").addEventListener("click", openProgramModal);
  document.getElementById("openProgramTop").addEventListener("click", openProgramModal);
  document.getElementById("editGoalBtn").addEventListener("click", openProgramModal);
  document.getElementById("closeLogModal").addEventListener("click", () => closeModal("logModal"));
  document.getElementById("cancelLogBtn").addEventListener("click", () => closeModal("logModal"));
  document.getElementById("closeProgramModal").addEventListener("click", () => closeModal("programModal"));
  document.getElementById("cancelProgramBtn").addEventListener("click", () => closeModal("programModal"));
  document.getElementById("logForm").addEventListener("submit", saveLog);
  document.getElementById("programForm").addEventListener("submit", saveProgram);
  document.getElementById("addExerciseBtn").addEventListener("click", () => addExerciseRow());
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) backdrop.hidden = true;
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeModal("logModal");
      closeModal("programModal");
    }
  });
}

ensureAssignments();
bindEvents();
renderAll();