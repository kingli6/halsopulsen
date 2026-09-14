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

function renderAssignments(assignments) {
  const target = document.getElementById("assignmentList");
  if (!assignments.length) {
    target.innerHTML = '<p class="client-empty">No published workouts are assigned yet.</p>';
    return;
  }
  target.innerHTML = assignments.map(item => `
    <article class="client-card">
      <div class="client-card-header">
        <div>
          <p class="section-kicker">${escapeHtml(formatDate(item.scheduled_date))}</p>
          <h3>${escapeHtml(item.workout_name || "Workout")}</h3>
          <p class="client-meta">${escapeHtml(item.program_name)} · Week ${escapeHtml(item.week_number)}</p>
        </div>
        <span class="client-status">${escapeHtml(item.status)}</span>
      </div>
      ${item.workout_description ? `<p>${escapeHtml(item.workout_description)}</p>` : ""}
      ${item.warmup ? `<p><strong>Warm-up:</strong> ${escapeHtml(item.warmup)}</p>` : ""}
      <ol class="client-exercises">
        ${(item.exercises || []).map(exercise => `<li>
          <strong>${escapeHtml(exercise.name)}</strong>
          <span class="client-exercise-meta">${escapeHtml(exerciseSummary(exercise))}</span>
          ${exercise.notes ? `<div>${escapeHtml(exercise.notes)}</div>` : ""}
        </li>`).join("") || "<li>No exercises listed.</li>"}
      </ol>
      ${item.cooldown ? `<p><strong>Cooldown:</strong> ${escapeHtml(item.cooldown)}</p>` : ""}
    </article>
  `).join("");
}

function renderSessions(sessions) {
  const target = document.getElementById("sessionList");
  if (!sessions.length) {
    target.innerHTML = '<p class="client-empty">No sessions have been recorded yet.</p>';
    return;
  }
  target.innerHTML = sessions.map(session => `
    <article class="client-card">
      <div class="client-card-header">
        <div>
          <p class="section-kicker">${escapeHtml(formatDate(session.completed_at || session.started_at))}</p>
          <h3>Recorded session</h3>
        </div>
        <span class="client-status">${escapeHtml(session.status)}</span>
      </div>
      <p class="client-meta">Difficulty: ${escapeHtml(session.difficulty ?? "—")} · Energy: ${escapeHtml(session.energy ?? "—")}</p>
      ${session.note ? `<p>${escapeHtml(session.note)}</p>` : ""}
    </article>
  `).join("");
}

async function loadClientPlan() {
  const match = window.location.pathname.match(/^\/client\/([^/]+)\/?$/);
  const token = match?.[1] || "";
  try {
    const response = await fetch(`/api/client/${encodeURIComponent(token)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "This private link is invalid or has been replaced.");
    document.title = `${result.data.client.displayName}'s training plan — HälsoPulsen`;
    document.getElementById("pageHeading").textContent = `${result.data.client.displayName}'s training plan`;
    document.getElementById("pageCopy").textContent = "Your assigned workouts and recorded sessions are shown below. Changes are disabled in this first version.";
    renderAssignments(result.data.assignments);
    renderSessions(result.data.sessions);
  } catch (error) {
    document.getElementById("pageHeading").textContent = "Training plan unavailable";
    document.getElementById("assignmentList").innerHTML = "";
    document.getElementById("sessionList").innerHTML = "";
    document.getElementById("errorText").textContent = error.message;
    document.getElementById("errorBanner").hidden = false;
  }
}

loadClientPlan();