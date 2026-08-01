const planState = {
  data: TrackerData.load(),
  ownerKey: TrackerData.getOwnerKey(),
  library: [],
  selectedWeekday: null,
  toastTimer: null,
  publishing: false
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
  planState.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function activitySummary(activity) {
  const target = TrackerData.targetLabel(activity);
  const intensity = TrackerData.intensityLabel(activity);
  if (activity.activityType === "run") return `${target}${intensity}`;
  return `${activity.sets} × ${target}${intensity} · ${TrackerData.formatRest(activity.restSeconds)} rest`;
}

function workoutSummary(workout) {
  return workout.exercises.map(activity => `${activity.name} · ${activitySummary(activity)}`).join(" · ");
}

function formatPublishedDate(value) {
  if (!value) return "Date not available";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderPlanOverview() {
  const program = planState.data.draftProgram;
  setPlanText("draftProgramName", program.name);
  setPlanText("planPerson", `For ${planState.data.person?.name || "my dashboard"}`);
  setPlanText("draftProgramDescription", program.description || "No description yet.");
  const changed = TrackerData.hasDraftChanges(planState.data);
  setPlanText("draftStatus", changed ? "Draft changes" : "Matches published plan");
  document.getElementById("draftStatus").className = `draft-status ${changed ? "is-draft" : "is-current"}`;
  setPlanText("publishedDetail", planState.data.publishedPlanId
    ? `Version ${planState.data.publishedProgram.version} published`
    : "Not published to a share link yet");
  setPlanText("publishHeading", changed ? "Publish when this week is ready" : "Your published plan is current");
  setPlanText("publishDescription", changed
    ? "Publishing creates a new immutable snapshot and a new share link. Future unlogged assignments use this week."
    : "The logging page and its share link are already showing this version.");
  const currentLink = document.getElementById("currentShareLink");
  if (currentLink) {
    currentLink.hidden = !planState.data.publishedSharePath;
    currentLink.href = planState.data.publishedSharePath || "#";
  }
}

function renderBuilder() {
  const program = planState.data.draftProgram;
  document.getElementById("builderGrid").innerHTML = TrackerData.WEEKDAYS.map(weekday => {
    const day = program.days.find(item => item.weekday === weekday) || TrackerData.emptyDay(weekday);
    const enabled = day.enabled && day.exercises.length;
    return `
      <article class="builder-day ${enabled ? "has-workout" : "rest-day"}">
        <div class="builder-day-top">
          <div>
            <span class="builder-day-name">${TrackerData.DAY_NAMES[weekday]}</span>
            <span class="builder-day-label">${enabled ? "Training day" : "Rest / open day"}</span>
          </div>
          <span class="day-number-large">${TrackerData.DAY_NAMES[weekday][0]}</span>
        </div>
        ${enabled ? `
          <div class="builder-workout">
            <h3>${escapePlanHtml(day.name)}</h3>
            <p>${escapePlanHtml(day.description || "No day note.")}</p>
            <ul>${day.exercises.map(activity => `<li>
              <strong>${escapePlanHtml(activity.name)}</strong>
              <span>${escapePlanHtml(activitySummary(activity))}</span>
            </li>`).join("")}</ul>
          </div>
          <div class="builder-actions">
            <button class="button button-secondary button-small" type="button" data-edit-day="${weekday}">Edit workout</button>
            <button class="text-button danger-button" type="button" data-clear-day="${weekday}">Clear day</button>
          </div>
        ` : `
          <div class="rest-placeholder"><span>○</span><p>No workout assigned.<br />This day is rest / open.</p></div>
          <button class="button button-secondary add-day-button" type="button" data-edit-day="${weekday}">+ Add workout</button>
        `}
      </article>
    `;
  }).join("");
}

function renderPublishedPreview() {
  const program = planState.data.publishedProgram;
  const container = document.getElementById("publishedPreview");
  if (!program || !planState.data.publishedPlanId) {
    container.innerHTML = `<div class="empty-panel">Publish the first version to create the live share link.</div>`;
    return;
  }
  container.innerHTML = TrackerData.WEEKDAYS.map(weekday => {
    const day = program.days.find(item => item.weekday === weekday) || TrackerData.emptyDay(weekday);
    const active = day.enabled && day.exercises.length;
    return `
      <div class="published-day ${active ? "has-workout" : "is-rest"}">
        <span class="published-day-label">${TrackerData.DAY_NAMES[weekday]}</span>
        <strong>${active ? escapePlanHtml(day.name) : "Rest / open day"}</strong>
        <span>${active ? escapePlanHtml(workoutSummary(day)) : "No assignment"}</span>
      </div>
    `;
  }).join("");
}

function renderLibrary() {
  const container = document.getElementById("planLibrary");
  if (!planState.library.length) {
    container.innerHTML = `<div class="empty-panel">Your published versions will appear here after you publish the first week.</div>`;
    return;
  }
  container.innerHTML = planState.library.map(plan => `
    <article class="library-item ${plan.id === planState.data.publishedPlanId ? "is-current" : ""}">
      <div class="library-item-main">
        <div class="library-item-title"><strong>${escapePlanHtml(plan.name)}</strong><span class="${plan.id === planState.data.publishedPlanId ? "current-tag" : "archived-tag"}">${plan.id === planState.data.publishedPlanId ? "Current" : "Archived"}</span></div>
        <span>For ${escapePlanHtml(plan.personName || "Participant")} · ${escapePlanHtml(plan.goal || "No goal")} · Version ${plan.version} · ${formatPublishedDate(plan.publishedAt)}</span>
      </div>
      <div class="library-actions">
        <button class="button button-secondary button-small" type="button" data-open-plan="${escapePlanHtml(plan.sharePath)}">Open</button>
        <button class="button button-secondary button-small" type="button" data-copy-plan="${escapePlanHtml(plan.sharePath)}">Copy link</button>
      </div>
    </article>
  `).join("");
}

function renderAllPlan() {
  renderPlanOverview();
  renderBuilder();
  renderPublishedPreview();
  renderLibrary();
}

function openDetailsModal() {
  document.getElementById("personNameInput").value = planState.data.person?.name || "";
  document.getElementById("goalInput").value = planState.data.draftGoal;
  document.getElementById("programNameInput").value = planState.data.draftProgram.name;
  document.getElementById("programDescriptionInput").value = planState.data.draftProgram.description;
  document.getElementById("detailsModal").hidden = false;
}

function closeDetailsModal() {
  document.getElementById("detailsModal").hidden = true;
}

function saveDetails(event) {
  event.preventDefault();
  const personName = document.getElementById("personNameInput").value.trim();
  const goal = document.getElementById("goalInput").value.trim();
  const name = document.getElementById("programNameInput").value.trim();
  if (!personName || !goal || !name) {
    showPlanToast("Add a person, goal, and plan name first.");
    return;
  }
  planState.data.person = { ...(planState.data.person || {}), name: personName };
  planState.data.draftGoal = goal;
  planState.data.draftProgram.name = name;
  planState.data.draftProgram.description = document.getElementById("programDescriptionInput").value.trim();
  planState.data.draftProgram.version += 1;
  TrackerData.save(planState.data);
  closeDetailsModal();
  showPlanToast("Plan details saved to the draft.");
  renderAllPlan();
}

function updateActivityRow(row) {
  const type = row.querySelector('[data-field="activityType"]').value;
  const unit = row.querySelector('[data-field="targetUnit"]');
  const currentUnit = unit.value;
  const options = type === "run"
    ? [{ value: "km", label: "km" }]
    : [{ value: "reps", label: "reps" }, { value: "minutes", label: "minutes" }, { value: "seconds", label: "seconds" }];
  unit.innerHTML = options.map(option => `<option value="${option.value}" ${option.value === currentUnit || (type === "run" && option.value === "km") ? "selected" : ""}>${option.label}</option>`).join("");
  const sets = row.querySelector('[data-field="sets"]');
  const rest = row.querySelector('[data-field="restSeconds"]');
  const targetLabel = row.querySelector("[data-target-label]");
  targetLabel.textContent = type === "run" ? "Distance" : "Target";
  sets.disabled = type === "run";
  rest.disabled = type === "run";
  if (type === "run") {
    sets.value = 1;
    rest.value = 0;
  }
}

function addActivityRow(activity = { name: "", activityType: "exercise", sets: 3, targetValue: 10, targetUnit: "reps", intensity: "", restSeconds: 90 }) {
  const list = document.getElementById("exerciseEditorList");
  const row = document.createElement("div");
  row.className = "activity-editor";
  row.innerHTML = `
    <label>Activity<input data-field="name" required maxlength="60" value="${escapePlanHtml(activity.name)}" placeholder="e.g. Squats or Run" /></label>
    <label>Type<select data-field="activityType"><option value="exercise" ${activity.activityType !== "run" ? "selected" : ""}>Exercise</option><option value="run" ${activity.activityType === "run" ? "selected" : ""}>Run</option></select></label>
    <label><span data-target-label>${activity.activityType === "run" ? "Distance" : "Target"}</span><input data-field="targetValue" type="number" min="0.1" step="0.1" value="${activity.targetValue ?? activity.reps ?? 10}" required /></label>
    <label>Unit<select data-field="targetUnit"><option value="reps" ${activity.targetUnit === "reps" ? "selected" : ""}>reps</option><option value="km" ${activity.targetUnit === "km" ? "selected" : ""}>km</option><option value="minutes" ${activity.targetUnit === "minutes" ? "selected" : ""}>minutes</option><option value="seconds" ${activity.targetUnit === "seconds" ? "selected" : ""}>seconds</option></select></label>
    <label>Intensity<select data-field="intensity"><option value="" ${!activity.intensity ? "selected" : ""}>Not set</option><option value="Easy" ${activity.intensity === "Easy" ? "selected" : ""}>Easy</option><option value="Steady" ${activity.intensity === "Steady" ? "selected" : ""}>Steady</option><option value="Moderate" ${activity.intensity === "Moderate" ? "selected" : ""}>Moderate</option><option value="Tempo" ${activity.intensity === "Tempo" ? "selected" : ""}>Tempo</option><option value="Intervals" ${activity.intensity === "Intervals" ? "selected" : ""}>Intervals</option><option value="Hard" ${activity.intensity === "Hard" ? "selected" : ""}>Hard</option></select></label>
    <label>Sets<input data-field="sets" type="number" min="1" max="20" value="${activity.sets || 1}" required /></label>
    <label>Rest (sec)<input data-field="restSeconds" type="number" min="0" max="3600" value="${activity.restSeconds || 0}" required /></label>
    <button class="remove-exercise" type="button" aria-label="Remove activity">×</button>
  `;
  row.querySelector('[data-field="activityType"]').addEventListener("change", () => updateActivityRow(row));
  row.querySelector(".remove-exercise").addEventListener("click", () => {
    if (list.children.length === 1) {
      showPlanToast("Keep at least one activity in this workout.");
      return;
    }
    row.remove();
  });
  list.appendChild(row);
  updateActivityRow(row);
}

function openWorkoutModal(weekday) {
  const day = planState.data.draftProgram.days.find(item => item.weekday === weekday);
  if (!day) return;
  planState.selectedWeekday = weekday;
  setPlanText("workoutModalTitle", `${day.enabled ? "Edit" : "Add"} ${TrackerData.DAY_NAMES[weekday]} workout`);
  document.getElementById("workoutNameInput").value = day.name || "";
  document.getElementById("workoutDescriptionInput").value = day.description || "";
  document.getElementById("exerciseEditorList").innerHTML = "";
  (day.exercises.length ? day.exercises : [{ name: "", activityType: "exercise", sets: 3, targetValue: 10, targetUnit: "reps", intensity: "", restSeconds: 90 }]).forEach(addActivityRow);
  document.getElementById("workoutModal").hidden = false;
}

function saveWorkout(event) {
  event.preventDefault();
  const rows = [...document.querySelectorAll("#exerciseEditorList .activity-editor")];
  const activities = rows.map(row => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    activityType: row.querySelector('[data-field="activityType"]').value,
    targetValue: Number(row.querySelector('[data-field="targetValue"]').value),
    targetUnit: row.querySelector('[data-field="targetUnit"]').value,
    intensity: row.querySelector('[data-field="intensity"]').value,
    sets: Number(row.querySelector('[data-field="sets"]').value),
    restSeconds: Number(row.querySelector('[data-field="restSeconds"]').value)
  })).filter(activity => activity.name && activity.targetValue > 0);
  const name = document.getElementById("workoutNameInput").value.trim();
  if (!name || !activities.length) {
    showPlanToast("Add a workout name and at least one activity.");
    return;
  }
  const weekday = planState.selectedWeekday;
  planState.data.draftProgram.days[weekday] = {
    weekday,
    enabled: true,
    name,
    description: document.getElementById("workoutDescriptionInput").value.trim(),
    exercises: activities.map(TrackerData.normalizeExercise)
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
  showPlanToast(`${TrackerData.DAY_NAMES[weekday]} is now Rest / open.`);
  renderAllPlan();
}

async function publishPlan() {
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
  if (planState.publishing) return;
  planState.publishing = true;
  const button = document.getElementById("publishBtn");
  button.disabled = true;
  button.textContent = "Publishing…";
  const nextData = TrackerData.clone(planState.data);
  const nextVersion = (nextData.publishedProgram?.version || 0) + 1;
  nextData.draftProgram.version = nextVersion;
  nextData.publishedGoal = nextData.draftGoal;
  nextData.goal = nextData.publishedGoal;
  nextData.publishedProgram = TrackerData.clone({ ...draft, version: nextVersion });
  nextData.publishedPlanId = null;
  nextData.publishedSharePath = "";
  const today = TrackerData.todayISO();
  nextData.assignments = nextData.assignments.filter(assignment =>
    assignment.date < today || TrackerData.logForAssignment(nextData, assignment.id)
  );
  TrackerData.ensureAssignments(nextData);
  try {
    const response = await fetch("/api/plans/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Owner-Key": planState.ownerKey },
      body: JSON.stringify({
        ownerKey: planState.ownerKey,
        personName: nextData.person?.name || "Participant",
        goal: nextData.publishedGoal,
        program: nextData.publishedProgram,
        assignments: nextData.assignments,
        logs: nextData.logs
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not publish the plan.");
    nextData.publishedPlanId = result.plan.id;
    nextData.publishedSharePath = result.plan.sharePath;
    planState.data = nextData;
    planState.library = [result.plan, ...planState.library.filter(plan => plan.id !== result.plan.id)];
    TrackerData.save(planState.data);
    showPlanToast(`Published. New share link created for version ${nextVersion}.`);
    renderAllPlan();
  } catch (error) {
    showPlanToast(error.message || "Could not publish the plan.");
  } finally {
    planState.publishing = false;
    button.disabled = false;
    button.textContent = "Publish plan";
  }
}

async function loadLibrary() {
  try {
    const response = await fetch("/api/plans/owner", { headers: { "X-Owner-Key": planState.ownerKey } });
    const result = await response.json();
    if (response.ok && result.ok) {
      planState.library = result.plans;
      const current = result.plans.find(plan => plan.id === planState.data.publishedPlanId);
      if (current && !planState.data.publishedSharePath) {
        planState.data.publishedSharePath = current.sharePath;
        TrackerData.save(planState.data);
      }
      renderLibrary();
    }
  } catch (error) {
    console.warn("Could not load plan library", error);
  }
}

async function copyPlanLink(path) {
  const link = new URL(path, window.location.origin).href;
  try {
    await navigator.clipboard.writeText(link);
    showPlanToast("Share link copied.");
  } catch (error) {
    window.prompt("Copy this share link:", link);
  }
}

function bindPlanEvents() {
  document.getElementById("editDetailsBtn").addEventListener("click", openDetailsModal);
  document.getElementById("detailsForm").addEventListener("submit", saveDetails);
  document.getElementById("closeDetailsModal").addEventListener("click", closeDetailsModal);
  document.getElementById("cancelDetailsBtn").addEventListener("click", closeDetailsModal);
  document.getElementById("publishBtn").addEventListener("click", publishPlan);
  document.getElementById("builderGrid").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-day]");
    const clear = event.target.closest("[data-clear-day]");
    if (edit) openWorkoutModal(Number(edit.dataset.editDay));
    if (clear) clearDay(Number(clear.dataset.clearDay));
  });
  document.getElementById("planLibrary").addEventListener("click", event => {
    const open = event.target.closest("[data-open-plan]");
    const copy = event.target.closest("[data-copy-plan]");
    if (open) window.open(open.dataset.openPlan, "_blank", "noopener");
    if (copy) copyPlanLink(copy.dataset.copyPlan);
  });
  document.getElementById("addExerciseBtn").addEventListener("click", () => addActivityRow());
  document.getElementById("workoutForm").addEventListener("submit", saveWorkout);
  document.getElementById("closeWorkoutModal").addEventListener("click", () => { document.getElementById("workoutModal").hidden = true; });
  document.getElementById("cancelWorkoutBtn").addEventListener("click", () => { document.getElementById("workoutModal").hidden = true; });
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) backdrop.hidden = true;
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      document.getElementById("detailsModal").hidden = true;
      document.getElementById("workoutModal").hidden = true;
    }
  });
}

TrackerData.ensureAssignments(planState.data);
TrackerData.save(planState.data);
bindPlanEvents();
renderAllPlan();
loadLibrary();