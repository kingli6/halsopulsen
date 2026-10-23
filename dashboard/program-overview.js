const programOverviewState = {
  programs: [],
  selectedProgramId: null,
  detail: null,
  activitySummaries: {},
  requestNumber: 0
};

function escapeProgramHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function programDate(value) {
  if (!value) return "Date not set";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function programLinkEndpoint(program) {
  return program.kind === "client" && program.clientId
    ? `/api/workoutplanner/clients/${encodeURIComponent(program.clientId)}/programs/${encodeURIComponent(program.id)}/link`
    : `/api/workoutplanner/programs/${encodeURIComponent(program.id)}/link`;
}

function isPublishedProgram(program) {
  return Boolean(
    program.hasCurrentVersion
    && program.hasPublishedVersion
    && program.currentVersion
  );
}

function getFilteredProgramOverviewPrograms() {
  const search = String(document.getElementById("programSearch")?.value || "")
    .trim()
    .toLocaleLowerCase();
  const statusFilter = document.getElementById("programStatusFilter")?.value || "all";
  return programOverviewState.programs
    .filter(isPublishedProgram)
    .filter(program => statusFilter === "legacy"
      ? program.kind === "client"
      : statusFilter === "published"
        ? program.kind !== "client"
        : true)
    .filter(program => !search || `${program.name || ""} ${program.personName || ""}`
      .toLocaleLowerCase()
      .includes(search));
}

function hasUnpublishedProgramDraft(program) {
  return program.versionStatus === "draft"
    && (Number(program.version) || 0) > (Number(program.currentVersion) || 0);
}

function renderProgramStatusBadges(program) {
  const legacy = program.kind === "client";
  const latestVersion = Number(program.version) || 1;
  return `
    <span class="program-overview-state-tag ${legacy ? "is-legacy" : "is-published"}">
      ${legacy ? "Client-assigned · legacy" : "Published · live"}
    </span>
    ${hasUnpublishedProgramDraft(program)
      ? `<span class="program-overview-state-tag is-draft">Saved update v${latestVersion} · not published</span>`
      : ""}`;
}

function renderProgramList() {
  const published = programOverviewState.programs.filter(isPublishedProgram);
  const visible = getFilteredProgramOverviewPrograms();
  const list = document.getElementById("programList");
  const status = document.getElementById("programListStatus");
  document.getElementById("programCount").textContent = String(published.length);

  if (!published.length) {
    status.textContent = "No live programs yet. Draft-only programs stay in the program library.";
    list.innerHTML = "";
    document.getElementById("programDetail").innerHTML = `
      <div class="empty-panel card">
        <p>No published or client-assigned programs are available in the overview.</p>
        <a class="button button-secondary" href="/admin/plans/">Open program library</a>
      </div>`;
    return;
  }

  if (!visible.length) {
    status.textContent = "No programs match your search and status filter.";
    list.innerHTML = `<p class="program-list-empty">Try another name or status.</p>`;
    return;
  }

  status.textContent = visible.length === published.length
    ? ""
    : `Showing ${visible.length} of ${published.length} current programs.`;
  list.innerHTML = visible.map(program => {
    const name = program.name || "Untitled program";
    const activity = programOverviewState.activitySummaries[program.id];
    const activityLabel = activity
      ? activity.lastActivity
        ? `Last activity ${escapeProgramHtml(programDate(activity.lastActivity))}`
        : "No activity yet"
      : "Activity not loaded";
    return `
      <button class="program-list-item${program.id === programOverviewState.selectedProgramId ? " is-selected" : ""}"
        type="button" data-program-id="${escapeProgramHtml(program.id)}"
        aria-label="Select ${escapeProgramHtml(name)}"
        aria-pressed="${program.id === programOverviewState.selectedProgramId ? "true" : "false"}">
        <span class="program-list-item-heading">
          <strong>${escapeProgramHtml(name)}</strong>
          <span class="program-overview-state-tags">${renderProgramStatusBadges(program)}</span>
        </span>
        <span class="program-list-item-meta">
          <span>Live v${escapeProgramHtml(program.currentVersion || "—")}</span>
          <span class="program-list-link-status ${program.hasActivePrivateLink ? "is-active" : "is-none"}">
            ${program.hasActivePrivateLink ? "Private link active" : "No private link"}
          </span>
          <span>${activityLabel}</span>
        </span>
      </button>`;
  }).join("");
}

async function loadProgramActivitySummary(programId) {
  try {
    const response = await fetch(`/api/workoutplanner/programs/${encodeURIComponent(programId)}/overview`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Activity could not be loaded.");
    const sessions = result.overview?.recentSessions || [];
    programOverviewState.activitySummaries[programId] = {
      lastActivity: sessions.find(session => session.status === "completed")?.performedOn || null
    };
  } catch {
    programOverviewState.activitySummaries[programId] = null;
  }
}

function formatPrescriptionSummary(prescription = {}) {
  const values = [];
  if (prescription.sets != null) values.push(`${prescription.sets} sets`);
  if (prescription.reps != null) values.push(`${prescription.reps} reps`);
  if (prescription.duration != null) values.push(`${prescription.duration} ${prescription.durationUnit || "min"}`);
  if (prescription.distance != null) values.push(`${prescription.distance} ${prescription.distanceUnit || "km"}`);
  if (prescription.load != null) values.push(`${prescription.load} ${prescription.loadUnit || "kg"}`);
  if (prescription.rir != null) values.push(`${prescription.rir} RIR`);
  return values.join(" · ") || "No prescription values";
}

function formatActualSet(set) {
  const values = [];
  if (set.reps != null) values.push(`${set.reps} reps`);
  if (set.duration != null) values.push(`${set.duration} ${set.durationUnit || "min"}`);
  if (set.distance != null) values.push(`${set.distance} ${set.distanceUnit || "km"}`);
  if (set.load != null) values.push(`${set.load} ${set.loadUnit || "kg"}`);
  return values.join(" · ") || "No values recorded";
}

function renderRecentSessions(sessions = []) {
  if (!sessions.length) {
    return `<p class="program-empty">No workouts have been recorded for this program yet.</p>`;
  }
  const improvements = window.WorkoutProgress?.findStrengthLoadImprovements(sessions) || [];
  return `<div class="program-session-list">${sessions.map(session => {
    const source = session.program?.versionNumber
      ? `Version ${escapeProgramHtml(session.program.versionNumber)}`
      : "Program session";
    const exercises = (session.exercises || []).map(exercise => {
      const actual = (exercise.actualSets || []).map(formatActualSet).join("; ") || "No performance values recorded";
      return `<li><strong>${escapeProgramHtml(exercise.name)}</strong>
        <div class="program-exercise-detail">Planned: ${escapeProgramHtml(formatPrescriptionSummary(exercise.prescription))}</div>
        <div class="program-exercise-detail">Recorded: ${escapeProgramHtml(actual)}</div>
      </li>`;
    }).join("");
    return `<article class="program-session-card">
      <div class="progress-card-heading">
        <div><h3>${escapeProgramHtml(session.workoutName || "Workout")}</h3>
          <p class="program-session-meta">${escapeProgramHtml(programDate(session.performedOn))} · ${escapeProgramHtml(source)}</p>
        </div>
        <span class="draft-status is-current">${escapeProgramHtml(session.status || "completed")}</span>
      </div>
      ${improvements
        .filter(improvement =>
          improvement.toSessionId === String(session.id)
          && (session.exercises || []).some(exercise =>
            String(exercise.name || "").toLocaleLowerCase() === improvement.exerciseName.toLocaleLowerCase()
          )
        )
        .map(improvement => `<p class="progress-improvement" role="note">${escapeProgramHtml(improvement.exerciseName)} load improved: ${escapeProgramHtml(improvement.fromLoad)} → ${escapeProgramHtml(improvement.toLoad)} ${escapeProgramHtml(improvement.unit)} · same ${escapeProgramHtml(improvement.setCount)} sets at ${escapeProgramHtml(improvement.repsLabel)} reps</p>`)
        .join("")}
      ${exercises ? `<ol class="program-exercise-list">${exercises}</ol>` : ""}
      ${session.note ? `<p class="program-progress-note"><strong>Note:</strong> ${escapeProgramHtml(session.note)}</p>` : ""}
    </article>`;
  }).join("")}</div>`;
}

function renderProgramDetail() {
  const program = programOverviewState.detail?.program;
  const detail = document.getElementById("programDetail");
  if (!program) {
    detail.innerHTML = `<div class="empty-panel card">Select a published program to review its private link and recent sessions.</div>`;
    return;
  }
  const listProgram = programOverviewState.programs.find(item => item.id === program.id) || program;
  const legacy = program.kind === "client";
  const linkStatus = program.hasActivePrivateLink
    ? "A private link is active. It opens the current published version and its session history."
    : "No active private link. Create one to share the current published version.";
  detail.innerHTML = `
    <div class="program-detail-stack">
      <header class="program-overview-heading card">
        <div>
          <p class="section-kicker">${legacy ? "EXISTING LINKED PROGRAM" : "PUBLISHED PROGRAM"}</p>
          <h2>${escapeProgramHtml(program.name)}</h2>
          <div class="program-overview-state-tags">${renderProgramStatusBadges(listProgram)}</div>
          <p class="program-overview-meta">Current version ${escapeProgramHtml(program.currentVersionNumber || "—")}
            ${program.startDate ? ` · Starts ${escapeProgramHtml(programDate(program.startDate))}` : ""}
            ${legacy ? " · Older linked program" : ""}
          </p>
        </div>
      </header>
      <section class="program-link-card card" aria-labelledby="privateLinkHeading">
        <div class="section-kicker">PRIVATE LINK</div>
        <h2 id="privateLinkHeading">Share current published version</h2>
        <p class="program-link-status" id="programLinkStatus" role="status" aria-live="polite">${escapeProgramHtml(linkStatus)}</p>
        <div class="program-link-actions">
          ${program.hasActivePrivateLink
            ? `<a class="button button-primary button-small"
                 href="${escapeProgramHtml(programLinkEndpoint(program))}?open=1"
                 target="_blank" rel="noopener">Open private program</a>
               <button class="button button-secondary button-small" type="button" data-link-action="copy">Copy private link</button>
               <button class="text-button" type="button" data-link-action="replace">Replace link</button>
               <button class="text-button danger-button" type="button" data-link-action="revoke">Revoke link</button>`
            : `<button class="button button-primary button-small" type="button" data-link-action="create">Create private link</button>`
          }
        </div>
      </section>
      <section class="program-progress-card card program-progress" aria-labelledby="recentProgressHeading">
        <p class="section-kicker">RECENT PROGRESS</p>
        <h2 id="recentProgressHeading">Recorded workouts</h2>
        ${renderRecentSessions(programOverviewState.detail.recentSessions || [])}
      </section>
    </div>`;
}

async function selectProgram(programId) {
  programOverviewState.selectedProgramId = programId;
  renderProgramList();
  const detail = document.getElementById("programDetail");
  detail.innerHTML = `<div class="empty-panel card">Loading program progress…</div>`;
  const requestNumber = ++programOverviewState.requestNumber;
  try {
    const response = await fetch(`/api/workoutplanner/programs/${encodeURIComponent(programId)}/overview`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Program progress could not be loaded.");
    if (requestNumber !== programOverviewState.requestNumber) return;
    programOverviewState.detail = result.overview;
    const recentSessions = result.overview?.recentSessions || [];
    programOverviewState.activitySummaries[programId] = {
      lastActivity: recentSessions.find(session => session.status === "completed")?.performedOn || null
    };
    renderProgramList();
    renderProgramDetail();
  } catch (error) {
    if (requestNumber !== programOverviewState.requestNumber) return;
    detail.innerHTML = `<p class="program-empty">${escapeProgramHtml(error.message)}</p>`;
  }
}

async function loadPrograms() {
  const status = document.getElementById("programListStatus");
  try {
    const response = await fetch("/api/workoutplanner/programs");
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Published programs could not be loaded.");
    programOverviewState.programs = Array.isArray(result.programs) ? result.programs : [];
    const firstPublished = programOverviewState.programs.find(isPublishedProgram);
    programOverviewState.activitySummaries = {};
    programOverviewState.selectedProgramId = firstPublished?.id || null;
    renderProgramList();
    if (firstPublished) {
      await selectProgram(firstPublished.id);
      const remaining = programOverviewState.programs
        .filter(program => isPublishedProgram(program) && program.id !== firstPublished.id);
      await Promise.all(remaining.map(program => loadProgramActivitySummary(program.id)));
      renderProgramList();
    }
  } catch (error) {
    status.textContent = error.message || "Published programs could not be loaded.";
    status.classList.add("is-error");
  }
}

async function copyProgramPrivateLink(program) {
  const status = document.getElementById("programLinkStatus");
  try {
    status.textContent = "Retrieving private link…";
    const response = await fetch(programLinkEndpoint(program));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "The private link could not be retrieved.");
    const url = new URL(result.path, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = "Private link copied.";
    } catch {
      window.prompt("Copy this private link:", url);
      status.textContent = "Private link ready to copy.";
    }
  } catch (error) {
    status.textContent = error.message || "The private link could not be retrieved.";
  }
}

async function updateProgramLink(program, action) {
  const status = document.getElementById("programLinkStatus");
  if (action === "replace" && !window.confirm("Replace this private link? The old link will stop working.")) return;
  if (action === "revoke" && !window.confirm("Revoke this private link? Anyone using it will lose access.")) return;
  try {
    if (action === "revoke") {
      const response = await fetch(programLinkEndpoint(program), { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The private link could not be revoked.");
      program.hasActivePrivateLink = false;
      status.textContent = result.revoked ? "Private link revoked." : "No active private link was found.";
    } else {
      status.textContent = action === "replace" ? "Replacing private link…" : "Creating private link…";
      const response = await fetch(programLinkEndpoint(program), { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The private link could not be created.");
      program.hasActivePrivateLink = true;
      const url = new URL(result.path, window.location.origin).href;
      try {
        await navigator.clipboard.writeText(url);
        status.textContent = action === "replace" ? "New private link copied. The old link no longer works." : "Private link created and copied.";
      } catch {
        window.prompt("Copy this private link:", url);
        status.textContent = "Private link created. Copy the link shown above.";
      }
    }
    const listProgram = programOverviewState.programs.find(item => item.id === program.id);
    if (listProgram) listProgram.hasActivePrivateLink = program.hasActivePrivateLink;
    if (programOverviewState.detail?.program?.id === program.id) {
      programOverviewState.detail.program.hasActivePrivateLink = program.hasActivePrivateLink;
    }
    renderProgramList();
    renderProgramDetail();
  } catch (error) {
    status.textContent = error.message || "The private link could not be updated.";
  }
}

document.getElementById("programList").addEventListener("click", event => {
  const item = event.target.closest("[data-program-id]");
  if (item) selectProgram(item.dataset.programId);
});

document.getElementById("programSearch").addEventListener("input", renderProgramList);
document.getElementById("programStatusFilter").addEventListener("change", renderProgramList);

document.getElementById("programDetail").addEventListener("click", event => {
  const button = event.target.closest("[data-link-action]");
  if (!button) return;
  const program = programOverviewState.programs.find(item => item.id === programOverviewState.selectedProgramId);
  if (!program) return;
  if (button.dataset.linkAction === "copy") copyProgramPrivateLink(program);
  else updateProgramLink(program, button.dataset.linkAction);
});

document.getElementById("adminLogoutBtn").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.assign("/admin");
});

loadPrograms();
