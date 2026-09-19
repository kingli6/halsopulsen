const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WEEKS = 52;
const MAX_ACTIVITIES = 30;

function isUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function numberOrNull(value) {
  if (value === "" || value == null || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number == null ? null : Math.trunc(number);
}

function dateOrNull(value) {
  const candidate = text(value);
  if (!candidate) return null;
  const match = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${candidate}T12:00:00Z`);
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])
  ) return null;
  return candidate;
}

function emptyDay(weekday) {
  return {
    weekday,
    enabled: false,
    name: "",
    description: "",
    sessionType: "Rest / open day",
    warmup: "",
    cooldown: "",
    exercises: []
  };
}

function normalizeActivity(activity) {
  const source = activity && typeof activity === "object" ? activity : {};
  const activityType = ["strength", "cardio", "guided"].includes(source.activityType)
    ? source.activityType
    : "strength";
  const format = text(source.format)
    || (activityType === "strength" ? "sets" : activityType === "cardio" ? "continuous" : "guided");
  const targetUnit = text(source.targetUnit || source.unit)
    || (format === "intervals" ? "rounds" : activityType === "guided" ? "minutes" : activityType === "cardio" ? "minutes" : "reps");
  const targetValue = numberOrNull(source.targetValue)
    ?? (targetUnit === "km" ? numberOrNull(source.distanceKm) : numberOrNull(source.reps))
    ?? numberOrNull(source.durationMinutes)
    ?? 1;

  return {
    name: text(source.name, "Exercise"),
    activityType,
    format,
    description: text(source.description),
    goal: text(source.goal),
    sets: Math.max(1, integerOrNull(source.sets) || 1),
    targetValue: Math.max(0.1, targetValue),
    targetUnit,
    durationMinutes: numberOrNull(source.durationMinutes),
    rounds: integerOrNull(source.rounds),
    workDurationSeconds: integerOrNull(source.workDurationSeconds),
    recoveryDurationSeconds: integerOrNull(source.recoveryDurationSeconds),
    intensity: source.intensity ?? "",
    heartRateTarget: text(source.heartRateTarget),
    rir: integerOrNull(source.rir),
    load: numberOrNull(source.load),
    loadUnit: source.loadUnit === "lb" ? "lb" : "kg",
    tempo: text(source.tempo),
    notes: text(source.notes),
    resourceUrl: text(source.resourceUrl),
    reps: Math.max(1, integerOrNull(source.reps) || 1),
    restSeconds: Math.max(0, integerOrNull(source.restSeconds) || 0),
    exerciseId: isUuid(source.exerciseId || source.exercise_id)
      ? String(source.exerciseId || source.exercise_id)
      : null
  };
}

function normalizeProgram(program) {
  if (!program || typeof program !== "object" || Array.isArray(program)) {
    const error = new Error("A program object is required.");
    error.statusCode = 400;
    throw error;
  }

  const sourceWeeks = Array.isArray(program.weeks) && program.weeks.length
    ? program.weeks
    : [{ weekNumber: program.weekNumber || 1, phase: program.phase, days: program.days }];

  if (sourceWeeks.length > MAX_WEEKS) {
    const error = new Error(`A program cannot contain more than ${MAX_WEEKS} weeks.`);
    error.statusCode = 400;
    throw error;
  }

  const weeks = sourceWeeks.map((sourceWeek, weekIndex) => {
    const rawDays = Array.isArray(sourceWeek?.days) ? sourceWeek.days : [];
    const days = Array.from({ length: 7 }, (_, weekday) => {
      const sourceDay = rawDays.find(day => Number(day?.weekday) === weekday);
      if (!sourceDay) return emptyDay(weekday);
      const exercises = Array.isArray(sourceDay.exercises)
        ? sourceDay.exercises.slice(0, MAX_ACTIVITIES).map(normalizeActivity)
        : [];
      return {
        weekday,
        enabled: Boolean(sourceDay.enabled) && exercises.length > 0,
        name: text(sourceDay.name),
        description: text(sourceDay.description),
        sessionType: text(sourceDay.sessionType, "Other") || "Other",
        warmup: text(sourceDay.warmup),
        cooldown: text(sourceDay.cooldown),
        exercises
      };
    });

    return {
      weekNumber: Math.max(1, integerOrNull(sourceWeek?.weekNumber) || weekIndex + 1),
      name: text(sourceWeek?.name || sourceWeek?.phase || `Week ${weekIndex + 1}`),
      phase: text(sourceWeek?.phase || program.phase || "Foundation"),
      progressionNotes: text(sourceWeek?.progressionNotes || program.progressionNotes),
      successMetric: text(sourceWeek?.successMetric || program.successMetric),
      days
    };
  });

  const firstWeek = weeks[0];
  return {
    name: text(program.name, "Training plan"),
    description: text(program.description),
    version: Math.max(1, integerOrNull(program.version) || 1),
    phase: firstWeek.phase,
    weekNumber: firstWeek.weekNumber,
    durationWeeks: weeks.length,
    startDate: dateOrNull(program.startDate),
    progressionNotes: firstWeek.progressionNotes,
    successMetric: firstWeek.successMetric,
    days: firstWeek.days,
    weeks
  };
}

function activityColumns(activity) {
  const type = activity.activityType;
  const format = activity.format;
  const targetValue = numberOrNull(activity.targetValue);
  let reps = null;
  let duration = null;
  let durationUnit = null;
  let distance = null;
  let distanceUnit = null;
  let workSeconds = null;
  let recoverySeconds = null;
  let rounds = null;

  if (type === "strength") {
    if (["seconds", "minutes"].includes(activity.targetUnit)) {
      duration = targetValue;
      durationUnit = activity.targetUnit;
    } else {
      reps = integerOrNull(targetValue);
    }
  } else if (type === "cardio" && format === "intervals") {
    rounds = integerOrNull(activity.rounds || targetValue);
    workSeconds = integerOrNull(activity.workDurationSeconds);
    recoverySeconds = integerOrNull(activity.recoveryDurationSeconds);
  } else if (type === "cardio" && activity.targetUnit === "km") {
    distance = targetValue;
    distanceUnit = "km";
  } else {
    duration = targetValue;
    durationUnit = type === "guided" ? "minutes" : "minutes";
  }

  const numericIntensity = numberOrNull(activity.intensity);
  return {
    reps,
    duration,
    durationUnit,
    distance,
    distanceUnit,
    load: activity.load,
    loadUnit: activity.loadUnit,
    rir: activity.rir,
    tempo: activity.tempo || null,
    restSeconds: activity.restSeconds,
    intensity: numericIntensity,
    intensityUnit: text(activity.intensityUnit) || null,
    workSeconds,
    recoverySeconds,
    rounds,
    notes: activity.notes,
    resourceUrl: activity.resourceUrl || null,
    plannerMetadata: {
      activityType: type,
      format,
      targetUnit: activity.targetUnit,
      goal: activity.goal,
      heartRateTarget: activity.heartRateTarget,
      intensity: activity.intensity,
      description: activity.description
    }
  };
}

function activityFromRow(row) {
  const metadata = row.planner_metadata && typeof row.planner_metadata === "object"
    ? row.planner_metadata
    : {};
  const activityType = metadata.activityType
    || (row.category === "cardio" ? "cardio" : row.category === "guided" ? "guided" : "strength");
  const format = metadata.format
    || (row.rounds != null ? "intervals" : activityType === "guided" ? "guided" : activityType === "cardio" ? "continuous" : "sets");

  let targetUnit = metadata.targetUnit;
  let targetValue;
  if (format === "intervals") {
    targetUnit = "rounds";
    targetValue = row.rounds || 1;
  } else if (row.distance != null) {
    targetUnit = row.distance_unit || "km";
    targetValue = Number(row.distance);
  } else if (row.duration != null) {
    targetUnit = row.duration_unit || "minutes";
    targetValue = Number(row.duration);
  } else {
    targetUnit = targetUnit || "reps";
    targetValue = Number(row.reps) || 1;
  }

  return {
    name: row.exercise_name,
    activityType,
    format,
    description: text(metadata.description),
    goal: text(metadata.goal),
    sets: Number(row.sets) || 1,
    targetValue,
    targetUnit,
    durationMinutes: row.duration_unit === "minutes" ? Number(row.duration) : null,
    rounds: row.rounds == null ? null : Number(row.rounds),
    workDurationSeconds: row.work_seconds == null ? null : Number(row.work_seconds),
    recoveryDurationSeconds: row.recovery_seconds == null ? null : Number(row.recovery_seconds),
    intensity: metadata.intensity ?? (row.intensity == null ? "" : String(row.intensity)),
    heartRateTarget: text(metadata.heartRateTarget),
    rir: row.rir == null ? null : Number(row.rir),
    load: row.load == null ? null : Number(row.load),
    loadUnit: row.load_unit || "kg",
    tempo: row.tempo || "",
    notes: row.notes || "",
    resourceUrl: row.resource_url || "",
    reps: row.reps == null ? 1 : Number(row.reps),
    restSeconds: row.rest_seconds == null ? 0 : Number(row.rest_seconds),
    unit: targetUnit,
    exerciseId: row.exercise_id
  };
}

async function resolveExercise(client, activity) {
  if (activity.exerciseId) {
    const byId = await client.query(
      "select id from public.exercises where id = $1 and active = true",
      [activity.exerciseId]
    );
    if (byId.rowCount === 1) return byId.rows[0].id;
  }

  const existing = await client.query(
    `select id
       from public.exercises
      where lower(name) = lower($1)
        and active = true
      order by created_at asc
      limit 1`,
    [activity.name]
  );
  if (existing.rowCount === 1) return existing.rows[0].id;

  const inserted = await client.query(
    `insert into public.exercises (name, description, category, default_resource_url)
     values ($1, $2, $3, $4)
     returning id`,
    [
      activity.name,
      activity.description,
      activity.activityType,
      activity.resourceUrl || null
    ]
  );
  return inserted.rows[0].id;
}

function dateValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function loadProgramWithClient(client, coachProfileId, programId) {
  const result = await client.query(
    `select
       p.id as program_id,
       p.name as program_name,
       p.description as program_description,
       p.status as program_status,
       p.kind as program_kind,
       p.source_program_id,
       p.source_version_id,
       p.updated_at as program_updated_at,
       p.start_date,
       pv.id as version_id,
       pv.version_number,
       pv.status as version_status,
       pw.id as week_id,
       pw.week_number,
       pw.name as week_name,
       pw.phase,
       pw.progression_notes,
       pw.success_metric,
       w.id as workout_id,
       w.day_of_week,
       w.name as workout_name,
       w.description as workout_description,
       w.session_type,
       w.warmup,
       w.cooldown,
       w.is_rest,
       we.id as workout_exercise_id,
       we.sort_order,
       we.exercise_id,
       we.sets,
       we.reps,
       we.duration,
       we.duration_unit,
       we.distance,
       we.distance_unit,
       we.load,
       we.load_unit,
       we.rir,
       we.tempo,
       we.rest_seconds,
       we.intensity,
       we.intensity_unit,
       we.work_seconds,
       we.recovery_seconds,
       we.rounds,
       we.notes,
       we.resource_url,
       we.planner_metadata,
       e.name as exercise_name,
       e.category
     from public.programs p
     left join lateral (
       select *
         from public.program_versions candidate
        where candidate.program_id = p.id
        order by candidate.version_number desc
        limit 1
     ) pv on true
     left join public.program_weeks pw on pw.program_version_id = pv.id
     left join public.workouts w on w.program_week_id = pw.id
     left join public.workout_exercises we on we.workout_id = w.id
     left join public.exercises e on e.id = we.exercise_id
    where p.id = $1
      and p.coach_profile_id = $2
    order by pv.version_number desc nulls last, pw.week_number, w.day_of_week, we.sort_order`,
    [programId, coachProfileId]
  );

  if (result.rowCount === 0) return null;
  const first = result.rows[0];
  const weeks = new Map();

  for (const row of result.rows) {
    if (!row.week_id) continue;
    if (!weeks.has(row.week_id)) {
      weeks.set(row.week_id, {
        weekNumber: Number(row.week_number),
        name: row.week_name || row.phase || `Week ${row.week_number}`,
        phase: row.phase || "Foundation",
        progressionNotes: row.progression_notes || "",
        successMetric: row.success_metric || "",
        days: Array.from({ length: 7 }, (_, weekday) => emptyDay(weekday))
      });
    }
    if (!row.workout_id) continue;
    const week = weeks.get(row.week_id);
    const weekday = Number(row.day_of_week) === 7 ? 0 : Number(row.day_of_week);
    const day = {
      weekday,
      enabled: !row.is_rest,
      name: row.workout_name || "",
      description: row.workout_description || "",
      sessionType: row.session_type || "Other",
      warmup: row.warmup || "",
      cooldown: row.cooldown || "",
      exercises: []
    };
    if (row.workout_exercise_id) day.exercises.push(activityFromRow(row));
    const previous = week.days.find(item => item.weekday === weekday);
    if (previous && previous.workoutId === row.workout_id) {
      previous.exercises.push(...day.exercises);
    } else {
      day.workoutId = row.workout_id;
      week.days[weekday] = day;
    }
  }

  const normalizedWeeks = [...weeks.values()].sort((a, b) => a.weekNumber - b.weekNumber);
  const firstWeek = normalizedWeeks[0] || {
    weekNumber: 1,
    name: "Week 1",
    phase: "Foundation",
    progressionNotes: "",
    successMetric: "",
    days: Array.from({ length: 7 }, (_, weekday) => emptyDay(weekday))
  };
  const program = {
    name: first.program_name,
    description: first.program_description || "",
    version: Number(first.version_number) || 1,
    phase: firstWeek.phase,
    weekNumber: firstWeek.weekNumber,
    durationWeeks: normalizedWeeks.length || 1,
    startDate: dateValue(first.start_date),
    progressionNotes: firstWeek.progressionNotes,
    successMetric: firstWeek.successMetric,
    days: firstWeek.days,
    weeks: normalizedWeeks
  };
  return {
    id: first.program_id,
    kind: first.program_kind || "library",
    sourceProgramId: first.source_program_id,
    sourceVersionId: first.source_version_id,
    status: first.program_status,
    versionStatus: first.version_status || "draft",
    updatedAt: first.program_updated_at,
    program
  };
}

async function loadProgram(db, coachProfileId, programId) {
  if (!isUuid(programId)) return null;
  return loadProgramWithClient(db, coachProfileId, programId);
}

async function listPrograms(db, coachProfileId) {
  const result = await db.query(
    `select
       p.id,
       p.name,
       p.description,
       p.status,
       p.kind,
       p.source_program_id,
       p.source_version_id,
       p.start_date,
       p.updated_at,
       latest.version_id,
       latest.version_number,
       latest.version_status,
       count(pw.id)::int as week_count
     from public.programs p
     left join lateral (
       select
         candidate.id as version_id,
         candidate.version_number,
         candidate.status as version_status
       from public.program_versions candidate
       where candidate.program_id = p.id
       order by candidate.version_number desc
       limit 1
     ) latest on true
     left join public.program_weeks pw
       on pw.program_version_id = (
         select candidate.id
           from public.program_versions candidate
          where candidate.program_id = p.id
          order by candidate.version_number desc
          limit 1
       )
    where p.coach_profile_id = $1
     group by p.id, latest.version_id, latest.version_number, latest.version_status
    order by p.updated_at desc`,
    [coachProfileId]
  );
  return result.rows.map(row => ({
     id: row.id,
     kind: row.kind || "library",
     sourceProgramId: row.source_program_id,
     sourceVersionId: row.source_version_id,
     versionId: row.version_id,
    name: row.name,
    description: row.description,
    status: row.status,
    startDate: dateValue(row.start_date),
    updatedAt: row.updated_at,
    version: Number(row.version_number) || 1,
    versionStatus: row.version_status || "draft",
    durationWeeks: Number(row.week_count) || 0
  }));
}

async function saveProgram(db, coachProfileId, inputProgram, programId = null) {
  if (!isUuid(coachProfileId)) {
    const error = new Error("A valid coach profile is required.");
    error.statusCode = 403;
    throw error;
  }
  if (programId && !isUuid(programId)) {
    const error = new Error("That program ID is invalid.");
    error.statusCode = 400;
    throw error;
  }

  const program = normalizeProgram(inputProgram);
  const client = await db.connect();
  try {
    await client.query("begin");
    let resolvedProgramId = programId;

    if (resolvedProgramId) {
      const owned = await client.query(
        `select id
           from public.programs
          where id = $1
            and coach_profile_id = $2
          for update`,
        [resolvedProgramId, coachProfileId]
      );
      if (owned.rowCount !== 1) {
        const error = new Error("Program not found.");
        error.statusCode = 404;
        throw error;
      }
      await client.query(
        `update public.programs
            set name = $1,
                description = $2,
                start_date = $3,
                updated_at = now()
          where id = $4
            and coach_profile_id = $5`,
        [program.name, program.description, program.startDate, resolvedProgramId, coachProfileId]
      );
    } else {
      const inserted = await client.query(
        `insert into public.programs
          (coach_profile_id, client_id, kind, name, description, status, start_date)
         values ($1, null, 'library', $2, $3, 'draft', $4)
         returning id`,
        [coachProfileId, program.name, program.description, program.startDate]
      );
      resolvedProgramId = inserted.rows[0].id;
    }

    const currentVersion = await client.query(
      `select id, version_number, status
         from public.program_versions
        where program_id = $1
        order by version_number desc
        limit 1
        for update`,
      [resolvedProgramId]
    );
    let versionId;
    let versionNumber;
    if (currentVersion.rowCount === 1 && currentVersion.rows[0].status === "draft") {
      versionId = currentVersion.rows[0].id;
      versionNumber = Number(currentVersion.rows[0].version_number);
      await client.query(
        `update public.program_versions
            set created_by = $1
          where id = $2`,
        [coachProfileId, versionId]
      );
      await client.query("delete from public.program_weeks where program_version_id = $1", [versionId]);
    } else {
      versionNumber = currentVersion.rowCount === 1
        ? Number(currentVersion.rows[0].version_number) + 1
        : program.version;
      const insertedVersion = await client.query(
        `insert into public.program_versions
          (program_id, version_number, status, created_by)
         values ($1, $2, 'draft', $3)
         returning id`,
        [resolvedProgramId, versionNumber, coachProfileId]
      );
      versionId = insertedVersion.rows[0].id;
    }

    for (const [weekIndex, week] of program.weeks.entries()) {
      const weekResult = await client.query(
        `insert into public.program_weeks
          (program_version_id, week_number, name, phase, progression_notes, success_metric)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          versionId,
          week.weekNumber || weekIndex + 1,
          week.name || week.phase || `Week ${weekIndex + 1}`,
          week.phase,
          week.progressionNotes,
          week.successMetric
        ]
      );
      const weekId = weekResult.rows[0].id;

      for (const day of week.days) {
        const dayOfWeek = Number(day.weekday) === 0 ? 7 : Number(day.weekday);
        const isRest = !day.enabled || !day.exercises.length;
        const workoutResult = await client.query(
          `insert into public.workouts
            (program_week_id, day_of_week, name, description, session_type, warmup, cooldown, is_rest)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id`,
          [
            weekId,
            dayOfWeek,
            day.name || (isRest ? "Rest / open day" : "Workout"),
            day.description,
            day.sessionType || "Other",
            day.warmup,
            day.cooldown,
            isRest
          ]
        );
        const workoutId = workoutResult.rows[0].id;

        for (const [activityIndex, activity] of day.exercises.entries()) {
          const exerciseId = await resolveExercise(client, activity);
          const columns = activityColumns(activity);
          await client.query(
            `insert into public.workout_exercises
              (workout_id, exercise_id, sort_order, sets, reps, duration, duration_unit,
               distance, distance_unit, load, load_unit, rir, tempo, rest_seconds,
               intensity, intensity_unit, work_seconds, recovery_seconds, rounds, notes,
               resource_url, planner_metadata)
             values
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, $21, $22::jsonb)`,
            [
              workoutId,
              exerciseId,
              activityIndex + 1,
              activity.sets,
              columns.reps,
              columns.duration,
              columns.durationUnit,
              columns.distance,
              columns.distanceUnit,
              columns.load,
              columns.loadUnit,
              columns.rir,
              columns.tempo,
              columns.restSeconds,
              columns.intensity,
              columns.intensityUnit,
              columns.workSeconds,
              columns.recoverySeconds,
              columns.rounds,
              columns.notes,
              columns.resourceUrl,
              JSON.stringify(columns.plannerMetadata)
            ]
          );
        }
      }
    }

    const saved = await loadProgramWithClient(client, coachProfileId, resolvedProgramId);
    await client.query("commit");
    return {
      ...saved,
      version: versionNumber
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function cloneLibraryProgramVersion(
  db,
  coachProfileId,
  sourceProgramId,
  sourceVersionId,
  clientProgramName
) {
  if (!isUuid(coachProfileId) || !isUuid(sourceProgramId) || !isUuid(sourceVersionId)) {
    const error = new Error("Valid coach, program, and version IDs are required.");
    error.statusCode = 400;
    throw error;
  }

  const name = text(clientProgramName);
  if (!name) {
    const error = new Error("A name is required for the client program.");
    error.statusCode = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query("begin");

    const sourceResult = await client.query(
      `select
         p.id,
         p.name,
         p.description,
         p.status,
         p.start_date,
         pv.id as version_id,
         pv.version_number,
         pv.status as version_status
       from public.programs p
       join public.program_versions pv on pv.program_id = p.id
      where p.id = $1
        and pv.id = $2
        and p.coach_profile_id = $3
        and p.kind = 'library'
      for update`,
      [sourceProgramId, sourceVersionId, coachProfileId]
    );
    if (sourceResult.rowCount !== 1) {
      const error = new Error("The selected library version was not found.");
      error.statusCode = 404;
      throw error;
    }
    const source = sourceResult.rows[0];

    const clientProgramResult = await client.query(
      `insert into public.programs
        (coach_profile_id, client_id, kind, source_program_id, source_version_id,
         name, description, status, start_date)
       values ($1, null, 'client', $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        coachProfileId,
        source.id,
        source.version_id,
        name,
        source.description || "",
        source.status,
        dateValue(source.start_date)
      ]
    );
    const clientProgramId = clientProgramResult.rows[0].id;

    const clientVersionResult = await client.query(
      `insert into public.program_versions
        (program_id, version_number, status, created_by)
       values ($1, 1, 'draft', $2)
       returning id`,
      [clientProgramId, coachProfileId]
    );
    const clientVersionId = clientVersionResult.rows[0].id;

    const weeks = await client.query(
      `select id, week_number, name, phase, progression_notes, success_metric
         from public.program_weeks
        where program_version_id = $1
        order by week_number`,
      [source.version_id]
    );

    for (const sourceWeek of weeks.rows) {
      const clientWeekResult = await client.query(
        `insert into public.program_weeks
          (program_version_id, week_number, name, phase, progression_notes, success_metric)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          clientVersionId,
          sourceWeek.week_number,
          sourceWeek.name,
          sourceWeek.phase,
          sourceWeek.progression_notes,
          sourceWeek.success_metric
        ]
      );
      const clientWeekId = clientWeekResult.rows[0].id;
      const workouts = await client.query(
        `select id, day_of_week, name, description, session_type, warmup, cooldown, is_rest
           from public.workouts
          where program_week_id = $1
          order by day_of_week`,
        [sourceWeek.id]
      );

      for (const sourceWorkout of workouts.rows) {
        const clientWorkoutResult = await client.query(
          `insert into public.workouts
            (program_week_id, day_of_week, name, description, session_type, warmup, cooldown, is_rest)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id`,
          [
            clientWeekId,
            sourceWorkout.day_of_week,
            sourceWorkout.name,
            sourceWorkout.description,
            sourceWorkout.session_type,
            sourceWorkout.warmup,
            sourceWorkout.cooldown,
            sourceWorkout.is_rest
          ]
        );
        const clientWorkoutId = clientWorkoutResult.rows[0].id;
        const exercises = await client.query(
          `select exercise_id, sort_order, sets, reps, duration, duration_unit,
                  distance, distance_unit, load, load_unit, rir, tempo, rest_seconds,
                  intensity, intensity_unit, work_seconds, recovery_seconds, rounds,
                  notes, resource_url, planner_metadata
             from public.workout_exercises
            where workout_id = $1
            order by sort_order`,
          [sourceWorkout.id]
        );

        for (const sourceExercise of exercises.rows) {
          await client.query(
            `insert into public.workout_exercises
              (workout_id, exercise_id, sort_order, sets, reps, duration, duration_unit,
               distance, distance_unit, load, load_unit, rir, tempo, rest_seconds,
               intensity, intensity_unit, work_seconds, recovery_seconds, rounds, notes,
               resource_url, planner_metadata)
             values
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, $21, $22)`,
            [
              clientWorkoutId,
              sourceExercise.exercise_id,
              sourceExercise.sort_order,
              sourceExercise.sets,
              sourceExercise.reps,
              sourceExercise.duration,
              sourceExercise.duration_unit,
              sourceExercise.distance,
              sourceExercise.distance_unit,
              sourceExercise.load,
              sourceExercise.load_unit,
              sourceExercise.rir,
              sourceExercise.tempo,
              sourceExercise.rest_seconds,
              sourceExercise.intensity,
              sourceExercise.intensity_unit,
              sourceExercise.work_seconds,
              sourceExercise.recovery_seconds,
              sourceExercise.rounds,
              sourceExercise.notes,
              sourceExercise.resource_url,
              sourceExercise.planner_metadata || {}
            ]
          );
        }
      }
    }

    const saved = await loadProgramWithClient(client, coachProfileId, clientProgramId);
    await client.query("commit");
    return {
      ...saved,
      sourceProgramId: source.id,
      sourceVersionId: source.version_id,
      sourceVersionNumber: Number(source.version_number),
      version: 1
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  cloneLibraryProgramVersion,
  listPrograms,
  loadProgram,
  normalizeProgram,
  saveProgram
};