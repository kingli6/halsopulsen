const clientPage = {
  token: "",
  data: null,
  preview: new URLSearchParams(window.location.search).get("preview") === "1"
};

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
  const canLog = !clientPage.preview && item.id;
  const canEdit = !directProgram
    && !clientPage.preview
    && !document.body.classList.contains("shared-program-workspace")
    && Boolean(findEditableDay(item.workout_id));
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
    ${canEdit ? renderProgramEditForm(item.workout_id) : ""}
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
  if (!section || !target) return;
  section.hidden = false;
  if (!history.length) {
    target.innerHTML = `<p class="client-empty">Saved performance will appear here after your first workout log.</p>`;
    return;
  }
  const improvements = window.WorkoutProgress?.findStrengthLoadImprovements(
    history.map(item => ({
      id: item.sessionId,
      status: "completed",
      performedOn: item.performedOn,
      exercises: [{ name: item.exerciseName, actualSets: item.sets || [] }]
    }))
  ) || [];
  target.innerHTML = history.map(item => `<article class="history-performance-card">
    <div class="history-performance-heading">
      <div><p class="section-kicker">${escapeHtml(formatDate(item.performedOn))}</p><h3>${escapeHtml(item.exerciseName)}</h3></div>
      <span class="client-meta">${escapeHtml(item.workoutName)}</span>
    </div>
    ${improvements
      .filter(improvement =>
        improvement.exerciseName.toLocaleLowerCase() === String(item.exerciseName || "").toLocaleLowerCase()
        && improvement.toSessionId === String(item.sessionId)
      )
      .map(improvement => `<p class="progress-improvement" role="note">Improved load: ${escapeHtml(improvement.fromLoad)} → ${escapeHtml(improvement.toLoad)} ${escapeHtml(improvement.unit)} · same ${escapeHtml(improvement.setCount)} sets at ${escapeHtml(improvement.repsLabel)} reps</p>`)
      .join("")}
    <p class="client-exercise-meta"><strong>Prescription at the time${item.prescription?.version ? ` · Version ${escapeHtml(item.prescription.version)}` : ""}:</strong> ${escapeHtml(formatPrescription(item.prescription))}</p>
    <p class="client-exercise-meta"><strong>Completed:</strong></p>
    <ol>${(item.sets || []).map((set, index) => `<li>Set ${index + 1}: ${escapeHtml(formatPerformanceSet(set))}</li>`).join("")}</ol>
  </article>`).join("");
}

function findEditableDay(workoutId) {
  for (const week of clientPage.data?.editableProgram?.weeks || []) {
    const day = week.days?.find(item => item.workoutId === workoutId);
    if (day) return { week, day };
  }
  return null;
}

function renderProgramEditForm(workoutId) {
  const match = findEditableDay(workoutId);
  if (!match) return "";
  const { week, day } = match;
  return `<details class="program-edit-panel">
    <summary>Edit this workout</summary>
    <form class="program-edit-form" data-program-edit
      data-workout-id="${escapeHtml(workoutId)}"
      data-week-number="${escapeHtml(week.weekNumber)}"
      data-weekday="${escapeHtml(day.weekday)}">
      <label>Workout name<input name="workoutName" maxlength="120" required value="${escapeHtml(day.name || "")}" /></label>
      <label>Workout notes<textarea name="description" rows="2" maxlength="1000">${escapeHtml(day.description || "")}</textarea></label>
      <label>Warm-up<textarea name="warmup" rows="2" maxlength="1000">${escapeHtml(day.warmup || "")}</textarea></label>
      <label>Cool-down<textarea name="cooldown" rows="2" maxlength="1000">${escapeHtml(day.cooldown || "")}</textarea></label>
      <h4>Exercise prescriptions</h4>
      ${(day.exercises || []).map((exercise, index) => `<section class="program-edit-exercise" data-exercise-edit>
        <label>Exercise name<input data-exercise-name maxlength="120" required value="${escapeHtml(exercise.name)}" /></label>
        <div class="program-edit-metrics">
          <label>Sets<input data-exercise-sets type="number" min="1" max="30" step="1" required value="${escapeHtml(exercise.sets)}" /></label>
          <label>Target · ${escapeHtml(exercise.targetUnit || "value")}<input data-exercise-target type="number" min="0.1" step="0.1" required value="${escapeHtml(exercise.targetValue)}" /></label>
        </div>
        <span class="client-meta">Exercise ${index + 1} · ${escapeHtml(exercise.activityType || "strength")}</span>
      </section>`).join("")}
      <p class="program-edit-status" data-program-status role="status" aria-live="polite"></p>
      <div class="session-log-actions">
        <button class="button button-primary" type="submit">Save updated workout</button>
        <button class="text-button" type="button" data-close-program-edit>Cancel</button>
      </div>
    </form>
  </details>`;
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
  if (clientPage.preview) {
    if (status) status.textContent = "Preview mode is read-only.";
    return;
  }
  if (!assignment || !clientPage.data?.program?.id) return;

  const exercises = readSessionForm(form);
  if (!exercises.length) {
    status.textContent = "Enter at least one value you actually completed.";
    return;
  }

  submit.disabled = true;
  status.textContent = "Saving performance…";
  try {
    const sessionEndpoint = `/api/client/${encodeURIComponent(clientPage.token)}/sessions${clientPage.preview ? "?preview=1" : ""}`;
    const response = await fetch(sessionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        programId: clientPage.data.program.id,
        ...(clientPage.data.directProgram
          ? {
            workoutId: assignment.workout_id,
            programVersionId: assignment.program_version_id
          }
          : { assignmentId }),
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

async function saveProgramEditForm(form) {
  const status = form.querySelector("[data-program-status]");
  const submit = form.querySelector('[type="submit"]');
  if (clientPage.preview) {
    status.textContent = "Preview mode is read-only.";
    return;
  }
  const program = JSON.parse(JSON.stringify(clientPage.data?.editableProgram || {}));
  const week = program.weeks?.find(item =>
    Number(item.weekNumber) === Number(form.dataset.weekNumber)
  );
  const day = week?.days?.find(item =>
    Number(item.weekday) === Number(form.dataset.weekday)
      && item.workoutId === form.dataset.workoutId
  );
  if (!day) {
    status.textContent = "This workout is no longer in the current plan. Reload the page.";
    return;
  }
  day.name = form.elements.workoutName.value.trim();
  day.description = form.elements.description.value.trim();
  day.warmup = form.elements.warmup.value.trim();
  day.cooldown = form.elements.cooldown.value.trim();
  const exerciseBlocks = [...form.querySelectorAll("[data-exercise-edit]")];
  if (exerciseBlocks.length !== day.exercises.length) {
    status.textContent = "This workout changed in another tab. Reload before saving.";
    return;
  }
  for (const [index, block] of exerciseBlocks.entries()) {
    const exercise = day.exercises[index];
    exercise.name = block.querySelector("[data-exercise-name]").value.trim();
    exercise.sets = Number(block.querySelector("[data-exercise-sets]").value);
    exercise.targetValue = Number(block.querySelector("[data-exercise-target]").value);
  }

  submit.disabled = true;
  status.textContent = "Saving a new current version…";
  try {
    const response = await fetch(
      `/api/client/${encodeURIComponent(clientPage.token)}/program${clientPage.preview ? "?preview=1" : ""}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program,
          expectedRevision: clientPage.data?.program?.revision
        })
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (response.status === 409 || result.code === "STALE_REVISION") {
        status.textContent = "This program changed in another tab. Reload the latest version before continuing.";
        form.querySelectorAll("input, textarea, button[type='submit']").forEach(control => {
          control.disabled = true;
        });
        const reload = document.createElement("button");
        reload.type = "button";
        reload.className = "button button-secondary";
        reload.dataset.reloadClientPlan = "true";
        reload.textContent = "Reload latest program";
        form.querySelector(".session-log-actions")?.append(reload);
        return;
      }
      throw new Error(result.error || "The workout could not be updated.");
    }
    const version = result.meta?.version;
    clientPage.notice = result.meta?.unchanged
      ? "No changes were needed."
      : `Workout saved as current version ${version}.`;
    await loadClientPlan();
  } catch (error) {
    status.textContent = error.message || "The workout could not be updated.";
    submit.disabled = false;
  }
}

document.getElementById("assignmentList")?.addEventListener("click", event => {
  const reload = event.target.closest("[data-reload-client-plan]");
  if (reload) {
    loadClientPlan();
    return;
  }
  const closeProgramEdit = event.target.closest("[data-close-program-edit]");
  if (closeProgramEdit) {
    const details = closeProgramEdit.closest("details");
    if (details) details.open = false;
    return;
  }
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

document.getElementById("assignmentList")?.addEventListener("submit", event => {
  if (event.target.matches("[data-program-edit]")) {
    event.preventDefault();
    saveProgramEditForm(event.target);
    return;
  }
  if (!event.target.matches("[data-assignment-form]")) return;
  event.preventDefault();
  saveSessionForm(event.target);
});

async function loadClientPlan() {
  const match = window.location.pathname.match(/^\/(?:p|client)\/([^/]+)\/?$/);
  if (!match) return;
  clientPage.token = match?.[1] || "";
  const sharedEditor = document.body.classList.contains("shared-program-workspace");
  const previewBanner = document.getElementById("previewBanner");
  if (previewBanner) previewBanner.hidden = !clientPage.preview;
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
      ? "Shared training program"
      : `${personName}'s training plan`;
    if (!sharedEditor) {
      document.title = `${planTitle} — HälsoPulsen`;
      const heading = document.getElementById("pageHeading");
      if (heading) heading.textContent = planTitle;
    }
    const editErrorBanner = document.getElementById("programEditErrorBanner");
    const saveBanner = document.getElementById("programSaveBanner");
    if (editErrorBanner) editErrorBanner.hidden = true;
    if (saveBanner) {
      saveBanner.hidden = !clientPage.notice;
      document.getElementById("programSaveText").textContent = clientPage.notice || "";
      clientPage.notice = "";
    }
    try {
      const editResponse = await fetch(`/api/client/${encodeURIComponent(clientPage.token)}/program`);
      const editResult = await editResponse.json().catch(() => ({}));
      if (!editResponse.ok || !editResult.ok) {
        throw new Error(editResult.error || "The current program could not be loaded.");
      }
      clientPage.data.editableProgram = editResult.program;
      clientPage.data.program.revision = editResult.meta?.revision;
      clientPage.data.program.version = editResult.meta?.version;
    } catch (error) {
      clientPage.data.editableProgram = null;
      if (editErrorBanner) editErrorBanner.hidden = false;
      const errorText = document.getElementById("programEditErrorText");
      if (errorText) errorText.textContent = error.message;
    }
    if (!sharedEditor) {
      const eyebrow = document.getElementById("pageEyebrow");
      if (eyebrow) eyebrow.textContent = clientPage.preview
        ? "OWNER PREVIEW · READ ONLY"
        : directProgram
          ? "PUBLISHED PROGRAM"
          : "YOUR SHARED TRAINING PLAN";
      const copy = document.getElementById("pageCopy");
      if (copy) copy.textContent = clientPage.preview
        ? "This is the current training view. Program edits and performance logging are disabled in preview; nothing here will be saved."
        : "Edit the program using the full editor and record completed workouts below. Saved program changes keep this private link.";
      const footer = document.getElementById("clientFooterNote");
      if (footer) footer.textContent = clientPage.preview
        ? "Preview only — plan edits and performance logging are disabled."
        : "This is the shared program and session history.";
    }
    renderAssignments(result.data.assignments || [], directProgram);
    renderPerformanceHistory(result.data.performanceHistory || []);
  } catch (error) {
    const heading = document.getElementById("pageHeading");
    if (heading && !document.body.classList.contains("shared-program-workspace")) {
      heading.textContent = "Training plan unavailable";
    }
    const assignmentList = document.getElementById("assignmentList");
    if (assignmentList) assignmentList.innerHTML = "";
    const errorText = document.getElementById("errorText");
    if (errorText) errorText.textContent = error.message;
    const errorBanner = document.getElementById("errorBanner");
    if (errorBanner) errorBanner.hidden = false;
  }
}

loadClientPlan();
window.addEventListener("workoutplanner:program-saved", loadClientPlan);