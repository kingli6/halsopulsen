(function attachClientSummary(root, createApi) {
  const api = createApi();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WorkoutPlannerClientSummary = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createClientSummaryApi() {
  function cleanLine(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function formatNumber(value) {
    return value == null || !Number.isFinite(Number(value))
      ? ""
      : String(Number(value));
  }

  function formatPrescription(prescription = {}) {
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
    if (prescription.tempo) items.push(`Tempo ${cleanLine(prescription.tempo)}`);
    return items.join(" · ");
  }

  function formatActualSet(set = {}) {
    const values = [];
    if (set.reps != null) values.push(`${formatNumber(set.reps)} reps`);
    if (set.duration != null) values.push(`${formatNumber(set.duration)} ${set.durationUnit || "minutes"}`);
    if (set.distance != null) values.push(`${formatNumber(set.distance)} ${set.distanceUnit || "km"}`);
    if (set.load != null) values.push(`@ ${formatNumber(set.load)} ${set.loadUnit || "kg"}`);
    if (set.rir != null) values.push(`${formatNumber(set.rir)} RIR`);
    if (!values.length) return "";
    const setNumber = formatNumber(set.setNumber);
    return `${setNumber ? `Set ${setNumber}` : "Set"}: ${values.join(" · ")}`;
  }

  function formatSessionStatus(status) {
    const labels = {
      completed: "Completed",
      skipped: "Skipped",
      missed: "Missed"
    };
    return labels[status] || cleanLine(status);
  }

  function buildClientSummary(overview) {
    const client = overview?.client || {};
    const lines = [];
    const clientName = cleanLine(client.displayName);
    if (clientName) lines.push(`Client: ${clientName}`);
    if (typeof client.active === "boolean") {
      lines.push(`Client status: ${client.active ? "Active" : "Inactive"}`);
    }

    const programs = Array.isArray(overview?.activePrograms)
      ? overview.activePrograms
      : [];
    if (programs.length) {
      lines.push("", "Current programs");
      for (const program of programs) {
        const details = [];
        if (program.currentVersionId && program.currentVersionNumber != null) {
          details.push(`Version ${formatNumber(program.currentVersionNumber)} (current published)`);
        } else if (program.currentVersionId) {
          details.push("Current published version");
        }
        if (program.startDate) details.push(`Starts ${cleanLine(program.startDate).slice(0, 10)}`);
        const programName = cleanLine(program.name);
        lines.push(`- ${programName || "Program"}${details.length ? ` — ${details.join(" · ")}` : ""}`);
      }
    }

    const sessions = Array.isArray(overview?.recentSessions)
      ? overview.recentSessions.slice(0, 5)
      : [];
    if (sessions.length) {
      lines.push("", "Recent activity (up to 5 entries)");
      for (const session of sessions) {
        const heading = [];
        if (session.performedOn) heading.push(cleanLine(session.performedOn).slice(0, 10));
        if (session.workoutName) heading.push(cleanLine(session.workoutName));
        const status = formatSessionStatus(session.status);
        if (status) heading.push(status);
        if (session.program?.name) {
          const source = [cleanLine(session.program.name)];
          if (session.program.versionNumber != null) {
            source.push(`version ${formatNumber(session.program.versionNumber)}`);
          }
          heading.push(`from ${source.join(" · ")}`);
        }
        if (heading.length) lines.push(`- ${heading.join(" — ")}`);

        for (const exercise of Array.isArray(session.exercises) ? session.exercises : []) {
          const exerciseName = cleanLine(exercise.name);
          const prescription = formatPrescription(exercise.prescription);
          const actualSets = (Array.isArray(exercise.actualSets) ? exercise.actualSets : [])
            .map(formatActualSet)
            .filter(Boolean);
          if (!exerciseName && !prescription && !actualSets.length) continue;
          if (exerciseName) lines.push(`  ${exerciseName}`);
          if (prescription) lines.push(`    Prescribed: ${prescription}`);
          if (actualSets.length) lines.push(`    Actual: ${actualSets.join("; ")}`);
        }

        const feedback = [];
        const note = cleanLine(session.note);
        if (note) feedback.push(`Note: ${note}`);
        if (session.difficulty != null) feedback.push(`Difficulty ${formatNumber(session.difficulty)}/10`);
        if (session.energy != null) feedback.push(`Energy ${formatNumber(session.energy)}/5`);
        if (feedback.length) lines.push(`  Feedback: ${feedback.join(" · ")}`);
      }
    }

    return lines.join("\n").trim();
  }

  async function tryCopyToClipboard(text, clipboard) {
    if (!String(text || "").trim() || !clipboard || typeof clipboard.writeText !== "function") {
      return false;
    }
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  return { buildClientSummary, tryCopyToClipboard };
});
