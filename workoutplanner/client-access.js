const crypto = require("crypto");

function hashClientAccessToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function generateClientAccessToken(linkId = crypto.randomUUID()) {
  const secret = String(process.env.SESSION_SECRET || "");
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured to create or recover private client links.");
  }
  return crypto.createHmac("sha256", secret)
    .update("workoutplanner-client-link:v1:")
    .update(String(linkId))
    .digest("base64url");
}

async function regenerateClientAccessLink(db, coachProfileId, clientId, programId) {
  const linkId = crypto.randomUUID();
  const token = generateClientAccessToken(linkId);
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
        (id, client_id, program_id, token_hash, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [linkId, clientId, programId, tokenHash, coachProfileId]
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

async function getClientAccessLink(db, coachProfileId, clientId, programId) {
  const result = await db.query(
    `SELECT l.id, l.token_hash, c.id AS client_id, c.display_name,
            p.id AS program_id, p.name AS program_name
       FROM public.client_access_links l
       JOIN public.clients c ON c.id = l.client_id
       JOIN public.coach_clients cc ON cc.client_id = c.id
       JOIN public.programs p
         ON p.id = l.program_id
        AND p.client_id = c.id
        AND p.kind = 'client'
        AND p.coach_profile_id = $1
      WHERE cc.coach_profile_id = $1
        AND c.id = $2
        AND p.id = $3
        AND l.revoked_at IS NULL
      LIMIT 2`,
    [coachProfileId, clientId, programId]
  );
  if (result.rowCount !== 1) return null;

  const row = result.rows[0];
  const token = generateClientAccessToken(row.id);
  const recoverable = hashClientAccessToken(token) === row.token_hash;
  return {
    token: recoverable ? token : null,
    recoverable,
    client: {
      id: row.client_id,
      display_name: row.display_name,
      program_id: row.program_id,
      program_name: row.program_name
    }
  };
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

async function regenerateProgramAccessLink(db, coachProfileId, programId) {
  const linkId = crypto.randomUUID();
  const token = generateClientAccessToken(linkId);
  const tokenHash = hashClientAccessToken(token);
  const connection = await db.connect();

  try {
    await connection.query("BEGIN");
    const programResult = await connection.query(
      `SELECT p.id, p.name, p.person_name
         FROM public.programs p
        WHERE p.id = $1
          AND p.coach_profile_id = $2
          AND p.kind = 'library'
          AND p.client_id IS NULL
          AND p.published_start_date IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM public.program_versions pv
             WHERE pv.program_id = p.id
               AND pv.status IN ('published', 'archived')
          )
        FOR UPDATE OF p`,
      [programId, coachProfileId]
    );
    if (programResult.rowCount !== 1) {
      await connection.query("ROLLBACK");
      return null;
    }

    await connection.query(
      `UPDATE public.client_access_links
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE program_id = $1
          AND client_id IS NULL
          AND revoked_at IS NULL`,
      [programId]
    );
    await connection.query(
      `INSERT INTO public.client_access_links
        (id, client_id, program_id, token_hash, created_by)
       VALUES ($1, NULL, $2, $3, $4)`,
      [linkId, programId, tokenHash, coachProfileId]
    );
    await connection.query("COMMIT");
    return { token, program: programResult.rows[0] };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function getProgramAccessLink(db, coachProfileId, programId) {
  const result = await db.query(
    `SELECT l.id, l.token_hash, p.id AS program_id, p.name AS program_name,
            p.person_name
       FROM public.client_access_links l
       JOIN public.programs p
         ON p.id = l.program_id
        AND p.kind = 'library'
        AND p.client_id IS NULL
        AND p.published_start_date IS NOT NULL
        AND p.coach_profile_id = $1
      WHERE l.program_id = $2
        AND l.client_id IS NULL
        AND l.revoked_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM public.program_versions pv
           WHERE pv.program_id = p.id
             AND pv.status IN ('published', 'archived')
        )
      LIMIT 2`,
    [coachProfileId, programId]
  );
  if (result.rowCount !== 1) return null;

  const row = result.rows[0];
  const token = generateClientAccessToken(row.id);
  const recoverable = hashClientAccessToken(token) === row.token_hash;
  return {
    token: recoverable ? token : null,
    recoverable,
    program: {
      id: row.program_id,
      name: row.program_name,
      person_name: row.person_name || ""
    }
  };
}

async function revokeProgramAccessLink(db, coachProfileId, programId) {
  const connection = await db.connect();

  try {
    await connection.query("BEGIN");
    const programResult = await connection.query(
      `SELECT p.id, p.name, p.person_name
         FROM public.programs p
        WHERE p.id = $1
          AND p.coach_profile_id = $2
          AND p.kind = 'library'
          AND p.client_id IS NULL
          AND p.published_start_date IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM public.program_versions pv
             WHERE pv.program_id = p.id
               AND pv.status IN ('published', 'archived')
          )
        FOR UPDATE OF p`,
      [programId, coachProfileId]
    );
    if (programResult.rowCount !== 1) {
      await connection.query("ROLLBACK");
      return null;
    }

    const revokeResult = await connection.query(
      `UPDATE public.client_access_links
          SET revoked_at = now()
        WHERE program_id = $1
          AND client_id IS NULL
          AND revoked_at IS NULL
        RETURNING id`,
      [programId]
    );
    await connection.query("COMMIT");
    return {
      program: programResult.rows[0],
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
    `SELECT c.id AS client_id, c.display_name, c.active,
            l.program_id, p.name AS program_name,
            p.kind AS program_kind
       FROM public.client_access_links l
       JOIN public.programs p
         ON p.id = l.program_id
       LEFT JOIN public.clients c ON c.id = l.client_id
      WHERE l.token_hash = $1
        AND l.revoked_at IS NULL
        AND (
          (
            l.client_id IS NULL
            AND p.kind = 'library'
            AND p.client_id IS NULL
            AND p.published_start_date IS NOT NULL
          )
          OR (
            l.client_id IS NOT NULL
            AND p.kind = 'client'
            AND p.client_id = l.client_id
            AND c.active = true
          )
        )
        AND EXISTS (
          SELECT 1
            FROM public.program_versions available_version
           WHERE available_version.program_id = p.id
             AND available_version.status IN ('published', 'archived')
        )
      LIMIT 2`,
    [tokenHash]
  );
  if (clientResult.rowCount !== 1) return null;

  const client = clientResult.rows[0];
  if (client.client_id == null) {
    const scheduleResult = await db.query(
      `SELECT
          to_char(
            p.published_start_date + (
              ((pw.week_number - 1) * 7) + (w.day_of_week - 1)
            )::integer,
            'YYYY-MM-DD'
          ) AS recommended_date,
          to_char(
            p.published_start_date + (
              ((pw.week_number - 1) * 7) + (w.day_of_week - 1)
            )::integer,
            'YYYY-MM-DD'
          ) AS scheduled_date,
          'planned'::text AS status,
          false AS moved,
          'Published program'::text AS program_name,
          NULL::text AS program_description,
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
        FROM public.programs p
        JOIN LATERAL (
          SELECT candidate.id, candidate.version_number, candidate.published_at
            FROM public.program_versions candidate
           WHERE candidate.program_id = p.id
             AND candidate.status IN ('published', 'archived')
           ORDER BY candidate.version_number DESC
           LIMIT 1
        ) pv ON true
        JOIN public.program_weeks pw ON pw.program_version_id = pv.id
        JOIN public.workouts w ON w.program_week_id = pw.id
        LEFT JOIN public.workout_exercises we ON we.workout_id = w.id
        LEFT JOIN public.exercises e ON e.id = we.exercise_id
       WHERE p.id = $1
         AND p.kind = 'library'
         AND p.client_id IS NULL
         AND w.is_rest = false
         AND EXISTS (
           SELECT 1
             FROM public.workout_exercises active_exercise
            WHERE active_exercise.workout_id = w.id
         )
       GROUP BY p.id, pv.id, pw.id, w.id
       ORDER BY pw.week_number, w.day_of_week`,
      [client.program_id]
    );

    const latestVersion = scheduleResult.rows[0] || {};
    return {
      client: null,
      directProgram: true,
      program: {
        id: client.program_id,
        name: "Published program",
        version: Number(latestVersion.version_number) || null,
        publishedAt: latestVersion.published_at || null
      },
      assignments: scheduleResult.rows
    };
  }

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
    [client.client_id, client.program_id]
  );

  return {
    client: { displayName: client.display_name },
    personName: client.display_name,
    directProgram: false,
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
       JOIN public.programs p ON p.id = l.program_id
       LEFT JOIN public.clients c ON c.id = l.client_id
      WHERE l.token_hash = $1
        AND l.revoked_at IS NULL
        AND (
          (
            l.client_id IS NULL
            AND p.kind = 'library'
            AND p.client_id IS NULL
            AND p.published_start_date IS NOT NULL
          )
          OR (
            l.client_id IS NOT NULL
            AND p.kind = 'client'
            AND p.client_id = l.client_id
            AND c.active = true
          )
        )
        AND EXISTS (
          SELECT 1
            FROM public.program_versions available_version
           WHERE available_version.program_id = p.id
             AND available_version.status IN ('published', 'archived')
        )
      LIMIT 1`,
    [tokenHash]
  );
  return result.rowCount === 1;
}

module.exports = {
  findClientDataByToken,
  generateClientAccessToken,
  getClientAccessLink,
  getProgramAccessLink,
  hashClientAccessToken,
  hasClientAccessToken,
  revokeClientAccessLink,
  revokeProgramAccessLink,
  regenerateProgramAccessLink,
  regenerateClientAccessLink
};
