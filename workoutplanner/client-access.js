const crypto = require("crypto");

function generateClientAccessToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashClientAccessToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

async function regenerateClientAccessLink(db, coachProfileId, clientId) {
  const token = generateClientAccessToken();
  const tokenHash = hashClientAccessToken(token);
  const result = await db.query(
    `UPDATE public.clients c
        SET client_access_token_hash = $1,
            updated_at = now()
      WHERE c.id = $2
        AND EXISTS (
          SELECT 1
            FROM public.coach_clients cc
           WHERE cc.client_id = c.id
             AND cc.coach_profile_id = $3
        )
      RETURNING c.id, c.display_name`,
    [tokenHash, clientId, coachProfileId]
  );
  if (result.rowCount !== 1) return null;
  return { token, client: result.rows[0] };
}

async function findClientDataByToken(db, token) {
  const tokenHash = hashClientAccessToken(token);
  if (!tokenHash) return null;

  const clientResult = await db.query(
    `SELECT id, display_name, active
       FROM public.clients
      WHERE client_access_token_hash = $1
        AND active = true
      LIMIT 2`,
    [tokenHash]
  );
  if (clientResult.rowCount !== 1) return null;

  const client = clientResult.rows[0];
  const [assignmentResult, sessionResult] = await Promise.all([
    db.query(
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
         AND p.client_id = $1
         AND pv.status = 'published'
       GROUP BY a.id, p.id, pv.id, pw.id, w.id
       ORDER BY a.scheduled_date, w.day_of_week`,
      [client.id]
    ),
    db.query(
      `SELECT
          ws.id,
          ws.assignment_id,
          ws.started_at,
          ws.completed_at,
          ws.status,
          ws.difficulty,
          ws.energy,
          ws.note,
          COALESCE(
            json_agg(
              json_build_object(
                'id', se.id,
                'sortOrder', se.sort_order,
                'name', e.name,
                'note', se.note,
                'sets', COALESCE((
                  SELECT json_agg(
                    json_build_object(
                      'setNumber', ss.set_number,
                      'reps', ss.reps,
                      'duration', ss.duration,
                      'durationUnit', ss.duration_unit,
                      'distance', ss.distance,
                      'distanceUnit', ss.distance_unit,
                      'load', ss.load,
                      'loadUnit', ss.load_unit,
                      'rir', ss.rir,
                      'intensity', ss.intensity,
                      'intensityUnit', ss.intensity_unit,
                      'completed', ss.completed,
                      'note', ss.note
                    )
                    ORDER BY ss.set_number
                  )
                  FROM public.session_sets ss
                  WHERE ss.session_exercise_id = se.id
                ), '[]'::json)
              )
              ORDER BY se.sort_order
            ) FILTER (WHERE se.id IS NOT NULL),
            '[]'::json
          ) AS exercises
        FROM public.workout_sessions ws
        LEFT JOIN public.session_exercises se ON se.session_id = ws.id
        LEFT JOIN public.exercises e ON e.id = se.exercise_id
       WHERE ws.client_id = $1
       GROUP BY ws.id
       ORDER BY COALESCE(ws.completed_at, ws.started_at, ws.created_at) DESC`,
      [client.id]
    )
  ]);

  return {
    client: { displayName: client.display_name },
    assignments: assignmentResult.rows,
    sessions: sessionResult.rows
  };
}

async function hasClientAccessToken(db, token) {
  const tokenHash = hashClientAccessToken(token);
  if (!tokenHash) return false;

  const result = await db.query(
    `SELECT 1
       FROM public.clients
      WHERE client_access_token_hash = $1
        AND active = true
      LIMIT 1`,
    [tokenHash]
  );
  return result.rowCount === 1;
}

module.exports = {
  findClientDataByToken,
  generateClientAccessToken,
  hashClientAccessToken,
  hasClientAccessToken,
  regenerateClientAccessLink
};
