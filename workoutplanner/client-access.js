const crypto = require("crypto");

function generateClientAccessToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashClientAccessToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

async function regenerateClientAccessLink(db, coachProfileId, clientId, programId) {
  const token = generateClientAccessToken();
  const tokenHash = hashClientAccessToken(token);
  const connection = await db.connect();

  try {
    await connection.query("BEGIN");
    const clientResult = await connection.query(
      `SELECT c.id, c.display_name, p.id AS program_id, p.name AS program_name
         FROM public.clients c
         JOIN public.coach_clients cc ON cc.client_id = c.id
         JOIN public.programs p
           ON p.client_id = c.id
          AND p.id = $2
          AND p.kind = 'client'
          AND p.coach_profile_id = $3
        WHERE c.id = $1
          AND cc.coach_profile_id = $3
        FOR UPDATE OF c`,
      [clientId, programId, coachProfileId]
    );
    if (clientResult.rowCount !== 1) {
      await connection.query("ROLLBACK");
      return null;
    }

    await connection.query(
      `UPDATE public.client_access_links
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE client_id = $1
          AND program_id = $2
          AND revoked_at IS NULL`,
      [clientId, programId]
    );
    await connection.query(
      `INSERT INTO public.client_access_links
        (client_id, program_id, token_hash, created_by)
       VALUES ($1, $2, $3, $4)`,
      [clientId, programId, tokenHash, coachProfileId]
    );
    await connection.query("COMMIT");
    return { token, client: clientResult.rows[0] };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function revokeClientAccessLink(db, coachProfileId, clientId, programId) {
  const connection = await db.connect();

  try {
    await connection.query("BEGIN");
    const clientResult = await connection.query(
      `SELECT c.id, c.display_name, p.id AS program_id, p.name AS program_name
         FROM public.clients c
         JOIN public.coach_clients cc ON cc.client_id = c.id
         JOIN public.programs p
           ON p.client_id = c.id
          AND p.id = $2
          AND p.kind = 'client'
          AND p.coach_profile_id = $3
        WHERE c.id = $1
          AND cc.coach_profile_id = $3
        FOR UPDATE OF c`,
      [clientId, programId, coachProfileId]
    );
    if (clientResult.rowCount !== 1) {
      await connection.query("ROLLBACK");
      return null;
    }

    const revokeResult = await connection.query(
      `UPDATE public.client_access_links
          SET revoked_at = now()
        WHERE client_id = $1
          AND program_id = $2
          AND revoked_at IS NULL
        RETURNING id`,
      [clientId, programId]
    );
    await connection.query("COMMIT");
    return {
      client: clientResult.rows[0],
      revoked: revokeResult.rowCount === 1
    };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function findClientDataByToken(db, token) {
  const tokenHash = hashClientAccessToken(token);
  if (!tokenHash) return null;

  const clientResult = await db.query(
    `SELECT c.id, c.display_name, c.active,
            l.program_id, p.name AS program_name
       FROM public.client_access_links l
       JOIN public.clients c ON c.id = l.client_id
       JOIN public.programs p
         ON p.id = l.program_id
        AND p.client_id = l.client_id
      WHERE l.token_hash = $1
        AND l.revoked_at IS NULL
        AND c.active = true
      LIMIT 2`,
    [tokenHash]
  );
  if (clientResult.rowCount !== 1) return null;

   const client = clientResult.rows[0];
  const assignmentResult = await db.query(
    `SELECT
        a.id,
        a.recommended_date,
        a.scheduled_date,
        a.status,
        a.moved,
        p.name AS program_name,
        p.description AS program_description,
        pv.version_number,
        pv.published_at,
        pw.week_number,
        pw.name AS week_name,
        w.id AS workout_id,
        w.day_of_week,
        w.name AS workout_name,
        w.description AS workout_description,
        w.session_type,
        w.warmup,
        w.cooldown,
        w.is_rest,
        COALESCE(
          json_agg(
            json_build_object(
              'id', we.id,
              'sortOrder', we.sort_order,
              'name', e.name,
              'description', e.description,
              'category', e.category,
              'sets', we.sets,
              'reps', we.reps,
              'duration', we.duration,
              'durationUnit', we.duration_unit,
              'distance', we.distance,
              'distanceUnit', we.distance_unit,
              'load', we.load,
              'loadUnit', we.load_unit,
              'rir', we.rir,
              'tempo', we.tempo,
              'restSeconds', we.rest_seconds,
              'intensity', we.intensity,
              'intensityUnit', we.intensity_unit,
              'workSeconds', we.work_seconds,
              'recoverySeconds', we.recovery_seconds,
              'rounds', we.rounds,
              'notes', we.notes,
              'resourceUrl', COALESCE(we.resource_url, e.default_resource_url)
            )
            ORDER BY we.sort_order
          ) FILTER (WHERE we.id IS NOT NULL),
          '[]'::json
        ) AS exercises
      FROM public.assignments a
      JOIN public.workouts w ON w.id = a.workout_id
      JOIN public.program_weeks pw ON pw.id = w.program_week_id
      JOIN public.program_versions pv ON pv.id = pw.program_version_id
      JOIN public.programs p ON p.id = pv.program_id
      LEFT JOIN public.workout_exercises we ON we.workout_id = w.id
      LEFT JOIN public.exercises e ON e.id = we.exercise_id
      WHERE a.client_id = $1
        AND p.id = $2
        AND p.client_id = $1
        AND p.kind = 'client'
       AND pv.status = 'published'
     GROUP BY a.id, p.id, pv.id, pw.id, w.id
     ORDER BY a.scheduled_date, w.day_of_week`,
    [client.id, client.program_id]
  );

  return {
    client: { displayName: client.display_name },
    program: { id: client.program_id, name: client.program_name },
    assignments: assignmentResult.rows
  };
}

async function hasClientAccessToken(db, token) {
  const tokenHash = hashClientAccessToken(token);
  if (!tokenHash) return false;

  const result = await db.query(
    `SELECT 1
       FROM public.client_access_links l
       JOIN public.clients c ON c.id = l.client_id
      WHERE l.token_hash = $1
        AND l.revoked_at IS NULL
        AND c.active = true
      LIMIT 1`,
    [tokenHash]
  );
  return result.rowCount === 1;
}

async function createClientForCoach(db, coachProfileId, displayName) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const profileResult = await client.query(
      `INSERT INTO public.profiles (role, display_name, clerk_user_id)
       VALUES ('client', $1, NULL)
       RETURNING id`,
      [displayName]
    );
    const profileId = profileResult.rows[0].id;
    const clientResult = await client.query(
      `INSERT INTO public.clients (profile_id, display_name)
       VALUES ($1, $2)
       RETURNING id, display_name`,
      [profileId, displayName]
    );
    const createdClient = clientResult.rows[0];
    await client.query(
      `INSERT INTO public.coach_clients (coach_profile_id, client_id)
       VALUES ($1, $2)`,
      [coachProfileId, createdClient.id]
    );
    await client.query("COMMIT");
    return {
      id: createdClient.id,
      displayName: createdClient.display_name
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createClientForCoach,
  findClientDataByToken,
  generateClientAccessToken,
  hashClientAccessToken,
  hasClientAccessToken,
  revokeClientAccessLink,
  regenerateClientAccessLink
};
