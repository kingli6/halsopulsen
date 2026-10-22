(function attachProgressInsights(root) {
  function comparableStrengthSets(exercise) {
    const sets = exercise?.actualSets || exercise?.sets;
    if (!Array.isArray(sets) || sets.length === 0) return null;

    const values = sets.map(set => ({
      reps: Number(set?.reps),
      load: Number(set?.load),
      unit: String(set?.loadUnit || "").trim().toLowerCase()
    }));
    if (values.some(set =>
      !Number.isFinite(set.reps)
      || set.reps <= 0
      || !Number.isFinite(set.load)
      || set.load <= 0
      || !set.unit
    )) return null;

    const unit = values[0].unit;
    if (values.some(set => set.unit !== unit)) return null;
    return {
      setCount: values.length,
      repsKey: values.map(set => set.reps).join(","),
      repsLabel: values.map(set => set.reps).join("/"),
      unit,
      topLoad: Math.max(...values.map(set => set.load))
    };
  }

  function findStrengthLoadImprovements(sessions = []) {
    const observationsByExercise = new Map();
    for (const [sessionIndex, session] of sessions.entries()) {
      if (session?.status && session.status !== "completed") continue;
      const sessionKey = String(
        session?.id
        || session?.sessionId
        || `${session?.performedOn || "undated"}:${sessionIndex}`
      );
      const seenExercises = new Set();
      for (const exercise of session?.exercises || []) {
        const name = String(exercise?.name || exercise?.exerciseName || "").trim();
        const key = name.toLocaleLowerCase();
        const comparable = comparableStrengthSets(exercise);
        if (!key || !comparable || seenExercises.has(key)) continue;
        seenExercises.add(key);
        if (!observationsByExercise.has(key)) observationsByExercise.set(key, []);
        observationsByExercise.get(key).push({
          exerciseName: name,
          performedOn: session.performedOn || "",
          sessionKey,
          ...comparable
        });
      }
    }

    const improvements = [];
    for (const observations of observationsByExercise.values()) {
      const byComparablePrescription = new Map();
      for (const observation of observations) {
        const signature = `${observation.setCount}|${observation.repsKey}|${observation.unit}`;
        if (!byComparablePrescription.has(signature)) byComparablePrescription.set(signature, []);
        byComparablePrescription.get(signature).push(observation);
      }
      const comparablePair = [...byComparablePrescription.values()]
        .map(items => [...new Map(items.map(item => [item.sessionKey, item])).values()]
          .sort((a, b) => String(b.performedOn).localeCompare(String(a.performedOn))))
        .filter(items => items.length >= 2)
        .sort((a, b) => String(b[0].performedOn).localeCompare(String(a[0].performedOn)))[0];
      if (!comparablePair) continue;

      const [latest, previous] = comparablePair;
      if (latest.topLoad <= previous.topLoad) continue;
      improvements.push({
        exerciseName: latest.exerciseName,
        fromLoad: previous.topLoad,
        toLoad: latest.topLoad,
        unit: latest.unit,
        setCount: latest.setCount,
        repsLabel: latest.repsLabel,
        fromDate: previous.performedOn,
        toDate: latest.performedOn,
        fromSessionId: previous.sessionKey,
        toSessionId: latest.sessionKey
      });
    }
    return improvements.sort((a, b) => String(b.toDate).localeCompare(String(a.toDate)));
  }

  const api = { findStrengthLoadImprovements };
  root.WorkoutProgress = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
