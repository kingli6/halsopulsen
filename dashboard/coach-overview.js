const overviewState = {
  clients: [],
  selectedClientId: null,
  requestNumber: 0
};

function escapeOverviewHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function displayDate(value) {
  if (!value) return "Date not recorded";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatNumber(value) {
  return value == null || !Number.isFinite(Number(value))
    ? ""
    : String(Number(value));
}

function formatStatus(status) {
  const labels = {
    completed: "Completed",
    skipped: "Skipped"
  };
  return labels[status] || (status ? status[0].toUpperCase() + status.slice(1) : "Unknown");
}

function clientProgramSummary(client) {
  const programs = client.activePrograms || [];
  return programs.length
    ? programs.map(program => `${program.name}${program.currentVersionNumber ? ` · v${program.currentVersionNumber}` : ""}`).join(", ")
    : "No active program";
}

function renderClientList() {
  const list = document.getElementById("clientList");
  const status = document.getElementById("clientListStatus");
  document.getElementById("clientCount").textContent = String(overviewState.clients.length);

  if (!overviewState.clients.length) {
    status.textContent = "No clients are connected to this coach profile.";
    list.innerHTML = "";
    return;
  }

  status.textContent = "";
  list.innerHTML = overviewState.clients.map(client => {
    const recentActivity = client.recentActivity;
    const activity = recentActivity
      ? `Last activity: ${displayDate(recentActivity.date)} · ${formatStatus(recentActivity.status)}`
      : "No recorded activity";
    return `
      <button
        class="coach-client-item${client.id === overviewState.selectedClientId ? " is-selected" : ""}"
        type="button"
        data-client-id="${escapeOverviewHtml(client.id)}"
        aria-pressed="${client.id === overviewState.selectedClientId ? "true" : "false"}"
      >
        <span class="coach-client-name">${escapeOverviewHtml(client.displayName)}</span>
        <span class="coach-client-programs">${escapeOverviewHtml(clientProgramSummary(client))}</span>
        <span class="coach-client-meta">${escapeOverviewHtml(activity)}</span>
      </button>
    `;
  }).join("");
}

function formatPrescription(prescription) {
  const items = [];
  const sets = formatNumber(prescription.sets);
  const reps = formatNumber(prescription.reps);
  if (sets && reps) items.push(`${sets} × ${reps} reps`);
  else if (sets) items.push(`${sets} sets`);
  else if (reps) items.push(`${reps} reps`);

  if (prescription.duration != null) {
    const duration = `${formatNumber(prescription.duration)} ${prescription.durationUnit || "minutes"}`;
    items.push(sets && !reps ? `${sets} × ${duration}` : duration);
  }
  if (prescription.distance != null) {
    const distance = `${formatNumber(prescription.distance)} ${prescription.distanceUnit || "km"}`;
    items.push(sets && !reps && prescription.duration == null ? `${sets} × ${distance}` : distance);
  }
  if (prescription.load != null) {
    items.push(`@ ${formatNumber(prescription.load)} ${prescription.loadUnit || "kg"}`);
  }
  if (prescription.rir != null) items.push(`${formatNumber(prescription.rir)} RIR`);
  if (prescription.tempo) items.push(`Tempo ${prescription.tempo}`);
  return items.join(" · ") || "No prescription values recorded";
}

function formatActualSet(set) {
  const values = [];
  if (set.reps != null) values.push(`${formatNumber(set.reps)} reps`);
  if (set.duration != null) values.push(`${formatNumber(set.duration)} ${set.durationUnit || "minutes"}`);
  if (set.distance != null) values.push(`${formatNumber(set.distance)} ${set.distanceUnit || "km"}`);
  if (set.load != null) values.push(`@ ${formatNumber(set.load)} ${set.loadUnit || "kg"}`);
  if (set.rir != null) values.push(`${formatNumber(set.rir)} RIR`);
  if (!values.length) values.push("Values not recorded");
  return `Set ${set.setNumber}: ${values.join(" · ")}`;
}

function renderWorkoutWeek(program) {
  const week = program.weeks?.[0];
  if (!week) return "";
  const dayNames = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const workouts = week.workouts.map(workout => {
    const label = workout.isRest ? "Rest" : workout.name;
    return `${dayNames[workout.dayOfWeek] || `Day ${workout.dayOfWeek}`} · ${label || "Workout"}`;
  });
  if (!workouts.length) return "";
  return `
    <div class="coach-program-week">
      <strong>${escapeOverviewHtml(week.name || `Week ${week.weekNumber}`)}</strong>
      <ul>${workouts.map(workout => `<li>${escapeOverviewHtml(workout)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderPrograms(programs) {
  if (!programs.length) {
    return `<p class="coach-empty">No active program is currently assigned.</p>`;
  }
  return `
    <div class="coach-program-list">
      ${programs.map(program => `
        <article class="coach-program-card card">
          <div class="coach-program-topline">
            <div>
              <h3>${escapeOverviewHtml(program.name)}</h3>
              <p class="coach-program-meta">
                ${program.currentVersionNumber
                  ? `Current version ${escapeOverviewHtml(program.currentVersionNumber)}`
                  : "No current version is set"}
                ${program.startDate ? ` · Starts ${escapeOverviewHtml(displayDate(program.startDate))}` : ""}
              </p>
            </div>
            <div class="coach-program-actions">
              <a class="button button-secondary button-small" href="/admin/plans/">Open program planner</a>
            </div>
          </div>
          ${program.currentVersionId
            ? renderWorkoutWeek(program) || `<p class="coach-program-meta">No week or workout details are available.</p>`
            : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderExercises(exercises) {
  if (!exercises.length) return "";
  return `
    <div class="coach-session-exercises">
      ${exercises.map(exercise => {
        const actualValues = exercise.actualSets.length
          ? exercise.actualSets.map(formatActualSet).join("; ")
          : "No actual performance values saved";
        return `
          <div class="coach-performance-row">
            <div>
              <h4>${escapeOverviewHtml(exercise.name)}</h4>
              <span class="coach-performance-label">Prescription</span>
              <p>${escapeOverviewHtml(formatPrescription(exercise.prescription))}</p>
            </div>
            <div>
              <span class="coach-performance-label">Actual result</span>
              <p>${escapeOverviewHtml(actualValues)}</p>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderSessions(sessions) {
  if (!sessions.length) {
    return `<p class="coach-empty">No completed or skipped sessions have been recorded.</p>`;
  }

  return `
    <div class="coach-session-list">
      ${sessions.map(session => {
        const noteParts = [];
        if (session.note) noteParts.push(`<span><strong>Note:</strong> ${escapeOverviewHtml(session.note)}</span>`);
        const ratings = [];
        if (session.difficulty != null) ratings.push(`Difficulty ${escapeOverviewHtml(session.difficulty)}/10`);
        if (session.energy != null) ratings.push(`Energy ${escapeOverviewHtml(session.energy)}/5`);
        if (ratings.length) noteParts.push(`<span>${ratings.join(" · ")}</span>`);
        const source = session.program
          ? `${escapeOverviewHtml(session.program.name || "Program")}${session.program.versionNumber ? ` · version ${escapeOverviewHtml(session.program.versionNumber)}` : ""}`
          : "";
        return `
          <article class="coach-session-card card">
            <div class="coach-session-topline">
              <div>
                <h3>${escapeOverviewHtml(session.workoutName)}</h3>
                <p class="coach-session-meta">
                  ${escapeOverviewHtml(displayDate(session.performedOn))}
                  ${source ? ` · ${source}` : ""}
                </p>
              </div>
              <span class="status-pill coach-status status-${escapeOverviewHtml(session.status)}">${escapeOverviewHtml(formatStatus(session.status))}</span>
            </div>
            ${renderExercises(session.exercises)}
            ${noteParts.length ? `<p class="coach-session-note">${noteParts.join("<br>")}</p>` : ""}
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderClientOverview(overview) {
  const client = overview.client;
  const detail = document.getElementById("clientDetail");
  detail.innerHTML = `
    <header class="coach-detail-header card">
      <div>
        <p class="section-kicker">CLIENT OVERVIEW</p>
        <h2>${escapeOverviewHtml(client.displayName)}</h2>
        <p>${client.active ? "Active client" : "Inactive client"}</p>
      </div>
    </header>

    <section class="coach-detail-section" aria-labelledby="activeProgramsHeading">
      <div class="coach-detail-section-heading">
        <h2 id="activeProgramsHeading">Current programs</h2>
        <p>${overview.activePrograms.length} active</p>
      </div>
      ${renderPrograms(overview.activePrograms)}
    </section>

    <section class="coach-detail-section" aria-labelledby="recentSessionsHeading">
      <div class="coach-detail-section-heading">
        <h2 id="recentSessionsHeading">Recent sessions</h2>
        <p>Newest first</p>
      </div>
      ${renderSessions(overview.recentSessions)}
    </section>
  `;
}

async function selectClient(clientId, { updateUrl = true, replaceUrl = false } = {}) {
  if (!clientId) return;
  overviewState.selectedClientId = clientId;
  renderClientList();
  const requestNumber = ++overviewState.requestNumber;
  const detail = document.getElementById("clientDetail");
  detail.innerHTML = `<div class="coach-loading card">Loading client overview…</div>`;

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("client", clientId);
    window.history[replaceUrl ? "replaceState" : "pushState"]({}, "", url);
  }

  try {
    const response = await fetch(`/api/workoutplanner/clients/${encodeURIComponent(clientId)}/overview`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Could not load this client overview.");
    }
    if (requestNumber !== overviewState.requestNumber) return;
    renderClientOverview(result.overview);
  } catch (error) {
    if (requestNumber !== overviewState.requestNumber) return;
    detail.innerHTML = `<div class="coach-empty card">${escapeOverviewHtml(error.message || "Could not load this client overview.")}</div>`;
  }
}

async function loadClients() {
  const status = document.getElementById("clientListStatus");
  try {
    const response = await fetch("/api/workoutplanner/clients");
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Could not load clients.");
    }

    overviewState.clients = Array.isArray(result.clients) ? result.clients : [];
    const requestedId = new URLSearchParams(window.location.search).get("client");
    const selected = overviewState.clients.find(client => client.id === requestedId)
      || overviewState.clients[0];
    overviewState.selectedClientId = selected?.id || null;
    renderClientList();

    if (selected) {
      await selectClient(selected.id, { updateUrl: true, replaceUrl: true });
    } else {
      document.getElementById("clientDetail").innerHTML =
        `<div class="empty-panel card">No client overview is available yet.</div>`;
    }
  } catch (error) {
    status.textContent = error.message || "Could not load clients.";
    status.classList.add("is-error");
    document.getElementById("clientDetail").innerHTML =
      `<div class="coach-empty card">${escapeOverviewHtml(error.message || "Could not load clients.")}</div>`;
  }
}

document.getElementById("clientList").addEventListener("click", event => {
  const button = event.target.closest("[data-client-id]");
  if (button) selectClient(button.dataset.clientId);
});

window.addEventListener("popstate", () => {
  const clientId = new URLSearchParams(window.location.search).get("client");
  if (overviewState.clients.some(client => client.id === clientId)) {
    selectClient(clientId, { updateUrl: false });
  }
});

document.getElementById("adminLogoutBtn").addEventListener("click", async () => {
  const status = document.getElementById("overviewStatus");
  status.textContent = "";
  try {
    const response = await fetch("/api/admin/logout", { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not sign out.");
    window.location.assign("/admin");
  } catch (error) {
    status.textContent = error.message || "Could not sign out.";
  }
});

loadClients();
