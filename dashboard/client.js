const clientPage = { token: "", data: null };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function formatDate(value) {
  if (!value) return "Date not set";
  return new Intl.DateTimeFormat("en", {
    weekday: "short", year: "numeric", month: "short", day: "numeric"
  }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
}

function exerciseSummary(exercise) {
  const parts = [];
  if (exercise.sets) parts.push(`${exercise.sets} sets`);
  if (exercise.reps !== null && exercise.reps !== undefined) parts.push(`${exercise.reps} reps`);
  if (exercise.duration !== null && exercise.duration !== undefined) parts.push(`${exercise.duration} ${exercise.durationUnit || ""}`.trim());
  if (exercise.distance !== null && exercise.distance !== undefined) parts.push(`${exercise.distance} ${exercise.distanceUnit || ""}`.trim());
  return parts.join(" · ");
}

function formatPerformanceSet(set) {
  const parts = [];
  if (set.reps !== null && set.reps !== undefined) parts.push(`${set.reps} reps`);
  if (set.load !== null && set.load !== undefined) parts.push(`${set.load}${set.loadUnit ? ` ${set.loadUnit}` : ""}`);
  if (set.duration !== null && set.duration !== undefined) {
    parts.push(`${set.duration} ${set.durationUnit || "time"}`);
  }
  if (set.distance !== null && set.distance !== undefined) {
    parts.push(`${set.distance} ${set.distanceUnit || "distance"}`);
  }
  return parts.join(" · ") || "No values recorded";
}

function formatPrescription(prescription) {
  if (!prescription) return "Prescription not recorded";
  const parts = [];
  const activityType = String(prescription.activityType || "strength").toLowerCase();
  const format = String(prescription.format || "").toLowerCase();
  if (activityType === "strength") {
    if (prescription.sets != null) parts.push(`${prescription.sets} sets`);
    if (prescription.reps != null) parts.push(`${prescription.reps} reps`);
    if (prescription.load != null) {
      parts.push(`${prescription.load}${prescription.loadUnit ? ` ${prescription.loadUnit}` : ""}`);
    }
  } else if (format === "intervals") {
    if (prescription.rounds != null) parts.push(`${prescription.rounds} rounds`);
    if (prescription.workSeconds != null) parts.push(`${prescription.workSeconds} sec work`);
    if (prescription.recoverySeconds != null) parts.push(`${prescription.recoverySeconds} sec recovery`);
  }
  if (prescription.duration != null) {
    parts.push(`${prescription.duration} ${prescription.durationUnit || "time"}`);
  }
  if (prescription.distance != null) {
    parts.push(`${prescription.distance} ${prescription.distanceUnit || "distance"}`);
  }
  return parts.join(" · ") || "Prescription not recorded";
}

function inputField(metric, label, value = "", step = "0.1") {
  return `<label>${label}<input data-metric="${metric}" type="number" min="0" step="${step}" value="" inputmode="decimal" /></label>`;
}

function renderPerformanceExercise(exercise) {
  const previousSets = Array.isArray(exercise.previousPerformance?.sets)
    ? exercise.previousPerformance.sets
    : [];
  const setCount = Math.min(20, Math.max(1, Number(exercise.sets) || 1, previousSets.length));
  const type = String(exercise.category || "").toLowerCase();
  const format = String(exercise.format || "").toLowerCase();
  const strength = !["cardio", "guided"].includes(type);
  const continuousCardio = type === "cardio" && (!format || format === "continuous");
  const showDuration = !strength || exercise.duration !== null && exercise.duration !== undefined
    || previousSets.some(set => set.duration != null);
  const previousDistance = previousSets.find(set => set.distance != null);
  const distanceUnit = exercise.distanceUnit
    || previousDistance?.distanceUnit
    || (continuousCardio ? "km" : "");
  const showDistance = continuousCardio
    || exercise.distance !== null && exercise.distance !== undefined
    || previousSets.some(set => set.distance != null);
  const showLoad = strength || previousSets.some(set => set.load != null);

  const previous = exercise.previousPerformance;
  const previousMarkup = previous && previousSets.length
    ? `<div class="previous-performance">
         <p><strong>Previous · ${escapeHtml(formatDate(previous.performedOn))}</strong></p>
         <ol>${previousSets.map((set, index) => `<li>Set ${index + 1}: ${escapeHtml(formatPerformanceSet(set))}</li>`).join("")}</ol>
         <button class="text-button" type="button" data-use-previous="${escapeHtml(exercise.id)}">Use previous values</button>
       </div>`
    : "";

  return `<section class="performance-exercise" data-workout-exercise-id="${escapeHtml(exercise.id)}" data-distance-unit="${escapeHtml(distanceUnit)}">
    <div class="performance-exercise-heading">
      <div>
        <h4>${escapeHtml(exercise.name)}</h4>
        <p class="client-exercise-meta">${escapeHtml(exerciseSummary(exercise))}</p>
      </div>
      ${previous?.performedOn ? `<span class="previous-date">Last: ${escapeHtml(formatDate(previous.performedOn))}</span>` : ""}
    </div>
    ${previousMarkup}
    <div class="performance-sets">
      ${Array.from({ length: setCount }, (_, index) => `<div class="performance-set" data-performance-set>
        <strong>Set ${index + 1}</strong>
        ${strength ? inputField("reps", "Reps", "", "1") : ""}
        ${showLoad ? `<label>Load<select data-metric="loadUnit"><option value="kg"${exercise.loadUnit === "lb" ? "" : " selected"}>kg</option><option value="lb"${exercise.loadUnit === "lb" ? " selected" : ""}>lb</option></select><input data-metric="load" type="number" min="0" step="0.1" value="" inputmode="decimal" /></label>` : ""}
        ${showDuration ? inputField("duration", `Duration${exercise.durationUnit ? ` · ${escapeHtml(exercise.durationUnit)}` : ""}`) : ""}
        ${showDistance ? inputField("distance", `Distance${distanceUnit ? ` · ${escapeHtml(distanceUnit)}` : ""}`) : ""}
      </div>`).join("")}
    </div>
  </section>`;
}

function renderAssignment(item, directProgram) {
  const canLog = !directProgram && item.id;
  const details = (item.exercises || []).map(exercise => `<li>
      <strong>${escapeHtml(exercise.name)}</strong>
      <span class="client-exercise-meta">${escapeHtml(exerciseSummary(exercise))}</span>
      ${exercise.notes ? `<div>${escapeHtml(exercise.notes)}</div>` : ""}
    </li>`).join("") || "<li>No exercises listed.</li>";
  const form = canLog ? `<form class="session-log-form" data-assignment-form="${escapeHtml(item.id)}" hidden>
    <h4>Record what you did</h4>
    <label class="session-date-field">Session date<input name="performedOn" type="date" value="${escapeHtml(String(item.scheduled_date || "").slice(0, 10))}" required /></label>
    ${(item.exercises || []).map(renderPerformanceExercise).join("")}
    <label class="session-note-field">Session note<textarea name="note" rows="2" maxlength="1000" placeholder="Optional"></textarea></label>
    <p class="session-log-status" data-session-status role="status" aria-live="polite"></p>
    <div class="session-log-actions">
      <button class="button button-primary" type="submit">Save today’s performance</button>
      <button class="text-button" type="button" data-close-log>Cancel</button>
    </div>
  </form>` : "";

  return `<article class="client-card">
    <div class="client-card-header">
      <div>
        <p class="section-kicker">${escapeHtml(formatDate(item.scheduled_date))}</p>
        <h3>${escapeHtml(item.workout_name || "Workout")}</h3>
        <p class="client-meta">${escapeHtml(item.program_name)}${directProgram && item.version_number ? ` · Version ${escapeHtml(item.version_number)}` : ""} · Week ${escapeHtml(item.week_number)}</p>
      </div>
      <span class="client-status">${escapeHtml(item.status)}</span>
    </div>
    ${item.workout_description ? `<p>${escapeHtml(item.workout_description)}</p>` : ""}
    ${item.warmup ? `<p><strong>Warm-up:</strong> ${escapeHtml(item.warmup)}</p>` : ""}
    <ol class="client-exercises">${details}</ol>
    ${item.cooldown ? `<p><strong>Cooldown:</strong> ${escapeHtml(item.cooldown)}</p>` : ""}
    ${canLog ? `<button class="button button-secondary session-open-button" type="button" data-open-log="${escapeHtml(item.id)}">Log performance</button>` : ""}
    ${form}
  </article>`;
}

function renderAssignments(assignments, directProgram = false) {
  const target = document.getElementById("assignmentList");
  if (!assignments.length) {
    target.innerHTML = `<p class="client-empty">${directProgram
      ? "No workouts are scheduled in the published program."
      : "No published workouts are assigned yet."}</p>`;
    return;
  }
  target.innerHTML = assignments.map(item => renderAssignment(item, directProgram)).join("");
}

function renderPerformanceHistory(history = []) {
  const section = document.getElementById("performanceHistorySection");
  const target = document.getElementById("performanceHistory");
  section.hidden = Boolean(clientPage.data?.directProgram);
  if (!history.length) {
    target.innerHTML = `<p class="client-empty">Saved performance will appear here after your first workout log.</p>`;
    return;
  }
  target.innerHTML = history.map(item => `<article class="history-performance-card">
    <div class="history-performance-heading">
      <div><p class="section-kicker">${escapeHtml(formatDate(item.performedOn))}</p><h3>${escapeHtml(item.exerciseName)}</h3></div>
      <span class="client-meta">${escapeHtml(item.workoutName)}</span>
    </div>
    <p class="client-exercise-meta"><strong>Prescription at the time${item.prescription?.version ? ` · Version ${escapeHtml(item.prescription.version)}` : ""}:</strong> ${escapeHtml(formatPrescription(item.prescription))}</p>
    <p class="client-exercise-meta"><strong>Completed:</strong></p>
    <ol>${(item.sets || []).map((set, index) => `<li>Set ${index + 1}: ${escapeHtml(formatPerformanceSet(set))}</li>`).join("")}</ol>
  </article>`).join("");
}

function findAssignment(assignmentId) {
  return (clientPage.data?.assignments || []).find(item => item.id === assignmentId) || null;
}

function copyPreviousValues(button) {
  const exerciseId = button.dataset.usePrevious;
  const block = button.closest(".performance-exercise");
  const assignment = (clientPage.data?.assignments || []).find(item =>
    (item.exercises || []).some(exercise => exercise.id === exerciseId)
  );
  const exercise = assignment?.exercises?.find(item => item.id === exerciseId);
  const previousSets = exercise?.previousPerformance?.sets || [];
  if (!block || !previousSets.length) return;
  const previousDistance = previousSets.find(set => set.distance != null);
  if (previousDistance?.distanceUnit) block.dataset.distanceUnit = previousDistance.distanceUnit;

  block.querySelectorAll("[data-performance-set]").forEach((row, index) => {
    const previous = previousSets[index] || {};
    for (const metric of ["reps", "duration", "distance", "load", "loadUnit"]) {
      const input = row.querySelector(`[data-metric="${metric}"]`);
      if (!input) continue;
      const value = previous[metric];
      input.value = value === null || value === undefined ? "" : String(value);
    }
  });
}

function readSessionForm(form) {
  const exercises = [...form.querySelectorAll(".performance-exercise")].map(block => ({
    workoutExerciseId: block.dataset.workoutExerciseId,
    sets: [...block.querySelectorAll("[data-performance-set]")].map(row => {
      const value = metric => row.querySelector(`[data-metric="${metric}"]`)?.value.trim() || "";
      return {
        reps: value("reps"),
        duration: value("duration"),
        distance: value("distance"),
        distanceUnit: value("distance") ? block.dataset.distanceUnit : "",
        load: value("load"),
        loadUnit: value("loadUnit")
      };
    })
  }));
  return exercises.filter(exercise => exercise.sets.some(set =>
    [set.reps, set.duration, set.distance, set.load].some(value => value !== "")
  ));
}

async function saveSessionForm(form) {
  const assignmentId = form.dataset.assignmentForm;
  const assignment = findAssignment(assignmentId);
  const status = form.querySelector("[data-session-status]");
  const submit = form.querySelector('[type="submit"]');
  if (!assignment || !clientPage.data?.program?.id) return;

  const exercises = readSessionForm(form);
  if (!exercises.length) {
    status.textContent = "Enter at least one value you actually completed.";
    return;
  }

  submit.disabled = true;
  status.textContent = "Saving performance…";
  try {
    const response = await fetch(`/api/client/${encodeURIComponent(clientPage.token)}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        programId: clientPage.data.program.id,
        assignmentId,
        performedOn: form.elements.performedOn.value,
        note: form.elements.note.value,
        exercises
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "The performance could not be saved.");
    await loadClientPlan();
  } catch (error) {
    status.textContent = error.message || "The performance could not be saved.";
    submit.disabled = false;
  }
}

document.getElementById("assignmentList").addEventListener("click", event => {
  const open = event.target.closest("[data-open-log]");
  if (open) {
    const form = document.querySelector(`[data-assignment-form="${CSS.escape(open.dataset.openLog)}"]`);
    if (form) {
      form.hidden = false;
      form.scrollIntoView({ behavior: "smooth", block: "nearest" });
      form.querySelector('input[name="performedOn"]')?.focus();
    }
    return;
  }
  const close = event.target.closest("[data-close-log]");
  if (close) {
    const form = close.closest("form");
    if (form) form.hidden = true;
    return;
  }
  const usePrevious = event.target.closest("[data-use-previous]");
  if (usePrevious) copyPreviousValues(usePrevious);
});

document.getElementById("assignmentList").addEventListener("submit", event => {
  if (!event.target.matches("[data-assignment-form]")) return;
  event.preventDefault();
  saveSessionForm(event.target);
});

async function loadClientPlan() {
  const match = window.location.pathname.match(/^\/(?:p|client)\/([^/]+)\/?$/);
  clientPage.token = match?.[1] || "";
  try {
    const response = await fetch(`/api/client/${encodeURIComponent(clientPage.token)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "This private link is invalid or has been replaced.");
    clientPage.data = result.data;
    const personName = result.data.personName
      || result.data.client?.displayName
      || result.data.program?.name
      || "Training";
    const directProgram = Boolean(result.data.directProgram);
    const versionText = result.data.program?.version
      ? ` (version ${result.data.program.version})`
      : "";
    const planTitle = directProgram
      ? "Published training plan"
      : `${personName}'s training plan`;
    document.title = `${planTitle} — HälsoPulsen`;
    document.getElementById("pageHeading").textContent = planTitle;
    document.getElementById("pageEyebrow").textContent = directProgram
      ? "PUBLISHED PROGRAM · READ ONLY"
      : "PRIVATE TRAINING PLAN · YOUR LOG";
    document.getElementById("pageCopy").textContent = directProgram
      ? `The latest published version${versionText} is shown below. This generic program link is read-only and cannot save client performance.`
      : "Record the sets, reps, loads, time, or distance you completed. Previous results are references; only values you save are recorded for today.";
    document.getElementById("clientFooterNote").textContent = directProgram
      ? "This generic program link is read-only."
      : "Performance history is scoped to this client.";
    renderAssignments(result.data.assignments || [], directProgram);
    renderPerformanceHistory(result.data.performanceHistory || []);
  } catch (error) {
    document.getElementById("pageHeading").textContent = "Training plan unavailable";
    document.getElementById("assignmentList").innerHTML = "";
    document.getElementById("errorText").textContent = error.message;
    document.getElementById("errorBanner").hidden = false;
  }
}

loadClientPlan();