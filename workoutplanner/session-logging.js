const { hashClientAccessToken } = require("./client-access");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ""));
}

function isDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() + 1 === Number(match[2])
    && parsed.getUTCDate() === Number(match[3]);
}

function normalizeExerciseKey(value) {
  return String(value || "").trim().toLowerCase();
}

function optionalNumber(value, { integer = false } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    return NaN;
  }
  return number;
}

function normalizeSessionEntries(body) {
  if (!Array.isArray(body?.exercises) || body.exercises.length === 0 || body.exercises.length > 30) {
    const error = new Error("Record at least one exercise set before saving.");
    error.statusCode = 400;
    throw error;
  }

  const exerciseIds = new Set();
  const exercises = [];
  for (const source of body.exercises) {
    const workoutExerciseId = String(source?.workoutExerciseId || "");
    if (!isUuid(workoutExerciseId) || exerciseIds.has(workoutExerciseId)) {
      const error = new Error("Each prescribed exercise must be included only once.");
      error.statusCode = 400;
      throw error;
    }
    exerciseIds.add(workoutExerciseId);

    if (!Array.isArray(source?.sets) || source.sets.length > 30) {
      const error = new Error("An exercise can contain up to 30 recorded sets.");
      error.statusCode = 400;
      throw error;
    }

    const sets = source.sets.map((set, index) => {
      const reps = optionalNumber(set?.reps, { integer: true });
      const duration = optionalNumber(set?.duration);
      const distance = optionalNumber(set?.distance);
      const load = optionalNumber(set?.load);
      if ([reps, duration, distance, load].some(Number.isNaN)) {
        const error = new Error("Set values must be non-negative numbers.");
        error.statusCode = 400;
        throw error;
      }
      if (load !== null && !["kg", "lb"].includes(set?.loadUnit)) {
        const error = new Error("Choose kg or lb for each recorded load.");
        error.statusCode = 400;
        throw error;
      }
      if (reps === null && duration === null && distance === null && load === null) return null;
      return {
        setNumber: index + 1,
        reps,
        duration,
        distance,
        load,
        loadUnit: load === null ? null : set.loadUnit
      };
    }).filter(Boolean);

    if (sets.length) exercises.push({ workoutExerciseId, sets });
  }

  if (!exercises.length) {
    const error = new Error("Record at least one exercise set before saving.");
    error.statusCode = 400;
    throw error;
  }
  return exercises;
}

async function resolveClientProgramScope(client, token) {
  const tokenHash = hashClientAccessToken(token);
  if (!tokenHash) return null;
  const result = await client.query(
    `select l.client_id, p.id as program_id
       from public.client_access_links l
       join public.programs p
         on p.id = l.program_id
        and p.client_id = l.client_id
        and p.kind = 'client'
       join public.clients c
         on c.id = l.client_id
        and c.active = true
      where l.token_hash = $1
        and l.client_id is not null
        and l.revoked_at is null
        and p.current_version_id is not null
        and exists (
          select 1
            from public.program_versions pv
           where pv.id = p.current_version_id
             and pv.program_id = p.id
             and pv.status = 'published'
        )
      limit 2`,
    [tokenHash]
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function createClientExerciseIdentity(client, clientId, name) {
  const inserted = await client.query(
    `insert into public.client_exercises (client_id, name)
     values ($1, $2)
     on conflict (client_id, normalized_name) do nothing
     returning id`,
    [clientId, name]
  );
  if (inserted.rowCount === 1) return inserted.rows[0].id;

  const existing = await client.query(
    `select id
       from public.client_exercises
      where client_id = $1
        and normalized_name = lower(btrim($2))
      limit 1`,
    [clientId, name]
  );
  if (existing.rowCount !== 1) {
    throw new Error("Could not resolve the client's exercise identity.");
  }
  return existing.rows[0].id;
}

async function saveClientSession(db, token, body) {
  if (
    !isUuid(body?.programId)
    || !isUuid(body?.assignmentId)
  ) {
    const error = new Error("A valid client program and workout assignment are required.");
    error.statusCode = 400;
    throw error;
  }
  if (!isDateOnly(body.performedOn)) {
    const error = new Error("Choose a valid performance date.");
    error.statusCode = 400;
    throw error;
  }
  const exercises = normalizeSessionEntries(body);
  const note = String(body.note || "").trim().slice(0, 1000);
  const difficulty = body.difficulty === "" || body.difficulty == null
    ? null
    : Number(body.difficulty);
  const energy = body.energy === "" || body.energy == null
    ? null
    : Number(body.energy);
  if (difficulty !== null && (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 10)) {
    const error = new Error("Difficulty must be from 1 to 10.");
    error.statusCode = 400;
    throw error;
  }
  if (energy !== null && (!Number.isInteger(energy) || energy < 1 || energy > 5)) {
    const error = new Error("Energy must be from 1 to 5.");
    error.statusCode = 400;
    throw error;
  }

  const client = await db.connect();
  let transactionStarted = false;
  try {
    await client.query("begin");
    transactionStarted = true;

    const scope = await resolveClientProgramScope(client, token);
    if (!scope) {
      const error = new Error("Only an active client-specific program link can save performance.");
      error.statusCode = 403;
      throw error;
    }
    if (body.programId !== scope.program_id) {
      const error = new Error("The selected program does not match this private link.");
      error.statusCode = 403;
      throw error;
    }

    const assignment = await client.query(
      `select a.id, a.client_id, a.workout_id, p.id as program_id
         from public.assignments a
         join public.workouts w on w.id = a.workout_id
         join public.program_weeks pw on pw.id = w.program_week_id
         join public.program_versions pv on pv.id = pw.program_version_id
         join public.programs p on p.id = pv.program_id
        where a.id = $1
          and a.client_id = $2
          and p.id = $3
          and p.client_id = $2
          and p.kind = 'client'
          and pv.status in ('published', 'archived')
        for update of a`,
      [body.assignmentId, scope.client_id, scope.program_id]
    );
    if (assignment.rowCount !== 1) {
      const error = new Error("This assignment does not belong to the linked client program.");
      error.statusCode = 403;
      throw error;
    }

    const duplicate = await client.query(
      `select id
         from public.workout_sessions
        where assignment_id = $1
          and client_id = $2
        limit 1`,
      [body.assignmentId, scope.client_id]
    );
    if (duplicate.rowCount) {
      const error = new Error("Performance has already been saved for this workout.");
      error.statusCode = 409;
      throw error;
    }

    const prescribedResult = await client.query(
      `select id, exercise_name, sort_order, duration_unit, distance_unit, load_unit
         from public.workout_exercises
        where workout_id = $1`,
      [assignment.rows[0].workout_id]
    );
    const prescribed = new Map(prescribedResult.rows.map(row => [row.id, row]));
    for (const entry of exercises) {
      if (!prescribed.has(entry.workoutExerciseId)) {
        const error = new Error("A recorded exercise does not belong to this assigned workout.");
        error.statusCode = 403;
        throw error;
      }
    }

    const sessionResult = await client.query(
      `insert into public.workout_sessions
         (assignment_id, client_id, performed_on, status, difficulty, energy,
          note, started_at, completed_at)
       values ($1, $2, $3::date, 'completed', $4, $5, $6, now(), now())
       returning id`,
      [body.assignmentId, scope.client_id, body.performedOn, difficulty, energy, note]
    );
    const sessionId = sessionResult.rows[0].id;

    for (const entry of exercises) {
      const prescription = prescribed.get(entry.workoutExerciseId);
      const identityId = await createClientExerciseIdentity(
        client,
        scope.client_id,
        prescription.exercise_name
      );
      const sessionExerciseResult = await client.query(
        `insert into public.session_exercises
           (session_id, workout_exercise_id, exercise_id, client_exercise_id,
            activity_name, sort_order)
         values ($1, $2, null, $3, $4, $5)
         returning id`,
        [
          sessionId,
          prescription.id,
          identityId,
          prescription.exercise_name,
          prescription.sort_order
        ]
      );
      const sessionExerciseId = sessionExerciseResult.rows[0].id;
      for (const set of entry.sets) {
        await client.query(
          `insert into public.session_sets
             (session_exercise_id, set_number, reps, duration, duration_unit,
              distance, distance_unit, load, load_unit, completed)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
          [
            sessionExerciseId,
            set.setNumber,
            set.reps,
            set.duration,
            set.duration === null ? null : prescription.duration_unit,
            set.distance,
            set.distance === null ? null : prescription.distance_unit,
            set.load,
            set.load === null ? null : set.loadUnit
          ]
        );
      }
    }

    await client.query(
      `update public.assignments
          set status = 'completed',
              updated_at = now()
        where id = $1
          and client_id = $2`,
      [body.assignmentId, scope.client_id]
    );
    await client.query("commit");
    transactionStarted = false;
    return { id: sessionId, clientId: scope.client_id, programId: scope.program_id };
  } catch (error) {
    if (transactionStarted) await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  normalizeExerciseKey,
  normalizeSessionEntries,
  saveClientSession
};
