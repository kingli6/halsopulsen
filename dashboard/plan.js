const planState = {
  data: TrackerData.load(),
  selectedWeekday: null,
  toastTimer: null
};

function setPlanText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapePlanHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function showPlanToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(planState.toastTimer);
  planState.toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function workoutSummary(workout) {
  return workout.exercises.map(exercise =>
    `${exercise.name} · ${exercise.sets} × ${exercise.reps}${exercise.unit === "reps" ? "" : ` ${exercise.unit}`}`
  ).join(" · ");
}

function renderPlanOverview() {
  const program = planState.data.draftProgram;
  setPlanText("draftProgramName", program.name);
  setPlanText("draftProgramDescription", program.description || "No description yet.");
  document.getElementById("goalInput").value = planState.data.draftGoal;
  document.getElementById("programNameInput").value = program.name;
  document.getElementById("programDescriptionInput").value = program.description;
  const changed = TrackerData.hasDraftChanges(planState.data);
  setPlanText("draftStatus", changed ? "Draft changes" : "Matches published plan");
  document.getElementById("draftStatus").className = `draft-status ${changed ? "is-draft" : "is-current"}`;
  if (planState.data.publishedProgram) {
    setPlanText("publishedDetail", `Version ${planState.data.publishedProgram.version} published`);
    setPlanText("publishHeading", changed ? "Publish these changes" : "Your published plan is current");
    setPlanText("publishDescription", changed
      ? "Publishing replaces future unlogged assignments with this new weekly structure. Logged history stays unchanged."
      : "The logging page is already showing this version.");
  }
}

function renderBuilder() {
  const program = planState.data.draftProgram;
  document.getElementById("builderGrid").innerHTML = program.days.map(day => {
    const enabled = day.enabled && day.exercises.length;
    return `
      <article class="builder-day ${enabled ? "has-workout" : "rest-day"}">
        <div class="builder-day-top">
          <div>
            <span class="builder-day-name">${TrackerData.DAY_NAMES[day.weekday]}</span>
            <span class="builder-day-label">${enabled ? "Training day" : "Rest / open day"}</span>
          </div>
          <span class="day-number-large">${day.weekday}</span>
        </div>
        ${enabled ? `
          <div class="builder-workout">
            <h3>${escapePlanHtml(day.name)}</h3>
            <p>${escapePlanHtml(day.description || "No day note.")}</p>
            <ul>${day.exercises.map(exercise => `<li><strong>${escapePlanHtml(exercise.name)}</strong><span>${exercise.sets} × ${exercise.reps}${exercise.unit === "reps" ? "" : ` ${escapePlanHtml(exercise.unit)}`} · ${TrackerData.formatRest(exercise.restSeconds)} rest</span></li>`).join("")}</ul>
          </div>
          <div class="builder-actions">
            <button class="button button-secondary button-small" type="button" data-edit-day="${day.weekday}">Edit workout</button>
            <button class="text-button danger-button" type="button" data-clear-day="${day.weekday}">Clear day</button>
          </div>
        ` : `
          <div class="rest-placeholder"><span>○</span><p>No workout assigned.<br />The logging page will show this as an open day.</p></div>
          <button class="button button-secondary add-day-button" type="button" data-edit-day="${day.weekday}">+ Add workout</button>
        `}
      </article>
    `;
  }).join("");
}

function renderPublishedPreview() {
  const program = planState.data.publishedProgram;
  const container = document.getElementById("publishedPreview");
  if (!program) {
    container.innerHTML = `<div class="empty-panel">Nothing published yet.</div>`;
    return;
  }
  container.innerHTML = program.days.map(day => `
    <div class="published-day ${day.enabled && day.exercises.length ? "has-workout" : "is-rest"}">
      <span class="published-day-label">${TrackerData.DAY_NAMES[day.weekday]}</span>
      <strong>${day.enabled && day.exercises.length ? escapePlanHtml(day.name) : "Open day"}</strong>
      <span>${day.enabled && day.exercises.length ? escapePlanHtml(workoutSummary(day)) : "No assignment"}</span>
    </div>
  `).join("");
}

function renderAllPlan() {
  renderPlanOverview();
  renderBuilder();
  renderPublishedPreview();
}

function addExerciseRow(exercise = { name: "", sets: 3, reps: 10, restSeconds: 90, unit: "reps" }) {
  const list = document.getElementById("exerciseEditorList");
  const row = document.createElement("div");
  row.className = "exercise-editor";
  row.innerHTML = `
    <label>Exercise<input data-field="name" required maxlength="60" value="${escapePlanHtml(exercise.name)}" placeholder="e.g. Squats" /></label>
    <label>Sets<input data-field="sets" type="number" min="1" max="20" value="${exercise.sets}" required /></label>
    <label>Target<input data-field="reps" type="number" min="1" max="1000" value="${exercise.reps}" required /></label>
    <label>Unit<select data-field="unit"><option value="reps" ${exercise.unit === "reps" ? "selected" : ""}>reps</option><option value="minutes" ${exercise.unit === "minutes" ? "selected" : ""}>minutes</option><option value="seconds" ${exercise.unit === "seconds" ? "selected" : ""}>seconds</option></select></label>
    <label>Rest (sec)<input data-field="restSeconds" type="number" min="0" max="3600" value="${exercise.restSeconds}" required /></label>
    <button class="remove-exercise" type="button" aria-label="Remove exercise">×</button>
  `;
  row.querySelector(".remove-exercise").addEventListener("click", () => {
    if (list.children.length === 1) {
      showPlanToast("Keep at least one exercise in this workout.");
      return;
    }
    row.remove();
  });
  list.appendChild(row);
}

function openWorkoutModal(weekday) {
  const day = planState.data.draftProgram.days.find(item => item.weekday === weekday);
  if (!day) return;
  planState.selectedWeekday = weekday;
  setPlanText("workoutModalTitle", `${day.enabled ? "Edit" : "Add"} ${TrackerData.DAY_NAMES[weekday]} workout`);
  document.getElementById("workoutNameInput").value = day.name || "";
  document.getElementById("workoutDescriptionInput").value = day.description || "";
  document.getElementById("exerciseEditorList").innerHTML = "";
  (day.exercises.length ? day.exercises : [{ name: "", sets: 3, reps: 10, restSeconds: 90, unit: "reps" }]).forEach(addExerciseRow);
  document.getElementById("workoutModal").hidden = false;
}

function saveDetails() {
  const goal = document.getElementById("goalInput").value.trim();
  const name = document.getElementById("programNameInput").value.trim();
  if (!goal || !name) {
    showPlanToast("Add a goal and program name first.");
    return;
  }
  planState.data.goal = goal;
  planState.data.draftGoal = goal;
  planState.data.draftProgram.name = name;
  planState.data.draftProgram.description = document.getElementById("programDescriptionInput").value.trim();
  TrackerData.save(planState.data);
  showPlanToast("Program details saved.");
  renderAllPlan();
}

function saveWorkout(event) {
  event.preventDefault();
  const rows = [...document.querySelectorAll("#exerciseEditorList .exercise-editor")];
  const exercises = rows.map(row => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    sets: Number(row.querySelector('[data-field="sets"]').value),
    reps: Number(row.querySelector('[data-field="reps"]').value),
    unit: row.querySelector('[data-field="unit"]').value,
    restSeconds: Number(row.querySelector('[data-field="restSeconds"]').value)
  })).filter(exercise => exercise.name);
  const name = document.getElementById("workoutNameInput").value.trim();
  if (!name || !exercises.length) {
    showPlanToast("Add a workout name and at least one exercise.");
    return;
  }
  const weekday = planState.selectedWeekday;
  planState.data.draftProgram.days[weekday] = {
    weekday,
    enabled: true,
    name,
    description: document.getElementById("workoutDescriptionInput").value.trim(),
    exercises: exercises.map(TrackerData.normalizeExercise)
  };
  planState.data.draftProgram.version += 1;
  TrackerData.save(planState.data);
  document.getElementById("workoutModal").hidden = true;
  showPlanToast(`${TrackerData.DAY_NAMES[weekday]} workout saved to the draft.`);
  renderAllPlan();
}

function clearDay(weekday) {
  const day = planState.data.draftProgram.days[weekday];
  if (!day?.enabled) return;
  if (!window.confirm(`Clear the ${TrackerData.DAY_NAMES[weekday]} workout from the draft?`)) return;
  planState.data.draftProgram.days[weekday] = TrackerData.emptyDay(weekday);
  planState.data.draftProgram.version += 1;
  TrackerData.save(planState.data);
  showPlanToast(`${TrackerData.DAY_NAMES[weekday]} is now an open day.`);
  renderAllPlan();
}

function publishPlan() {
  const draft = planState.data.draftProgram;
  const activeDays = draft.days.filter(day => day.enabled && day.exercises.length);
  if (!activeDays.length) {
    showPlanToast("Add at least one workout day before publishing.");
    return;
  }
  if (!TrackerData.hasDraftChanges(planState.data)) {
    showPlanToast("The published plan already matches this draft.");
    return;
  }
  const nextVersion = (planState.data.publishedProgram?.version || 0) + 1;
  planState.data.draftProgram.version = nextVersion;
  planState.data.publishedGoal = planState.data.draftGoal;
  planState.data.goal = planState.data.publishedGoal;
  planState.data.publishedProgram = TrackerData.clone({ ...draft, version: nextVersion });
  const today = TrackerData.todayISO();
  planState.data.assignments = planState.data.assignments.filter(assignment =>
    assignment.date < today || TrackerData.logForAssignment(planState.data, assignment.id)
  );
  TrackerData.ensureAssignments(planState.data);
  TrackerData.save(planState.data);
  showPlanToast("Plan published. The logging page now has the new week.");
  renderAllPlan();
}

function bindPlanEvents() {
  document.getElementById("saveDetailsBtn").addEventListener("click", saveDetails);
  document.getElementById("publishBtn").addEventListener("click", publishPlan);
  document.getElementById("builderGrid").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-day]");
    const clear = event.target.closest("[data-clear-day]");
    if (edit) openWorkoutModal(Number(edit.dataset.editDay));
    if (clear) clearDay(Number(clear.dataset.clearDay));
  });
  document.getElementById("addExerciseBtn").addEventListener("click", () => addExerciseRow());
  document.getElementById("workoutForm").addEventListener("submit", saveWorkout);
  document.getElementById("closeWorkoutModal").addEventListener("click", () => { document.getElementById("workoutModal").hidden = true; });
  document.getElementById("cancelWorkoutBtn").addEventListener("click", () => { document.getElementById("workoutModal").hidden = true; });
  document.getElementById("workoutModal").addEventListener("click", event => {
    if (event.target.id === "workoutModal") event.target.hidden = true;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") document.getElementById("workoutModal").hidden = true;
  });
}

TrackerData.ensureAssignments(planState.data);
TrackerData.save(planState.data);
bindPlanEvents();
renderAllPlan();