const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_ACTIVITY_LIMIT = 20;

function dateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function numberValue(value) {
  return value == null ? null : Number(value);
}

function asJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function listCoachClients(db, coachProfileId) {
  const result = await db.query(
    `select
       c.id as client_id,
       c.display_name,
       c.active,
       coalesce(program_data.programs, '[]'::jsonb) as programs,
       latest_activity.activity_date as last_activity_date,
       latest_activity.status as last_activity_status,
       latest_activity.activity_name as last_activity_name
     from public.clients c
     join public.coach_clients cc
       on cc.client_id = c.id
      and cc.coach_profile_id = $1
     left join lateral (
       select jsonb_agg(
         jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'status', case
              when p.status <> 'archived'
               and current_version.status = 'published'
             then 'active'
             else p.status
           end,
           'kind', p.kind,
           'currentVersionId', p.current_version_id,
           'currentVersionNumber', current_version.version_number,
           'startDate', p.start_date,
           'hasActivePrivateLink', exists (
             select 1
               from public.client_access_links link
              where link.client_id = c.id
                and link.program_id = p.id
                and link.revoked_at is null
           )
         )
         order by p.updated_at desc nulls last, p.created_at desc
       ) as programs
       from public.programs p
       left join public.program_versions current_version
         on current_version.id = p.current_version_id
        and current_version.program_id = p.id
       where p.client_id = c.id
         and p.coach_profile_id = cc.coach_profile_id
         and p.kind = 'client'
     ) program_data on true
     left join lateral (
       select activity.activity_date, activity.status, activity.activity_name
         from (
           select ws.performed_on as activity_date,
                  ws.status,
                  coalesce(nullif(btrim(w.name), ''), 'Workout') as activity_name,
                  ws.id as sort_id
             from public.workout_sessions ws
             left join public.assignments a on a.id = ws.assignment_id
             left join public.workouts w on w.id = coalesce(a.workout_id, ws.workout_id)
            where ws.client_id = c.id
              and ws.status in ('completed', 'skipped')
           union all
           select a.scheduled_date as activity_date,
                   a.status,
                  coalesce(nullif(btrim(w.name), ''), 'Workout') as activity_name,
                  a.id as sort_id
             from public.assignments a
             join public.workouts w on w.id = a.workout_id
            where a.client_id = c.id
               and a.status in ('skipped', 'missed')
              and not exists (
                select 1
                  from public.workout_sessions ws
                 where ws.assignment_id = a.id
              )
         ) activity
        order by activity.activity_date desc, activity.sort_id desc
        limit 1
     ) latest_activity on true
     order by c.display_name asc, c.created_at asc`,
    [coachProfileId]
  );

  return result.rows.map(row => {
    const programs = asJsonArray(row.programs).map(program => ({
      ...program,
      startDate: dateValue(program.startDate)
    }));
    const recentActivity = row.last_activity_date
      ? {
        date: dateValue(row.last_activity_date),
        status: row.last_activity_status,
        name: row.last_activity_name || "Workout"
      }
      : null;
    return {
      id: row.client_id,
      displayName: row.display_name,
      active: Boolean(row.active),
      programs,
      activePrograms: programs.filter(program => program.status === "active"),
      recentActivity
    };
  });
}

async function getClientOverview(db, coachProfileId, clientId) {
  if (!CLIENT_ID_PATTERN.test(String(clientId || ""))) return null;

  const clientResult = await db.query(
    `select c.id, c.display_name, c.active
       from public.clients c
       join public.coach_clients cc on cc.client_id = c.id
      where c.id = $1
        and cc.coach_profile_id = $2
      limit 1`,
    [clientId, coachProfileId]
  );
  if (clientResult.rowCount !== 1) return null;

  const programResult = await db.query(
    `select
       p.id as program_id,
       p.name as program_name,
       p.current_version_id,
       p.start_date,
       current_version.version_number as current_version_number,
       pw.id as week_id,
       pw.week_number,
       pw.name as week_name,
       w.id as workout_id,
       w.name as workout_name,
       w.day_of_week,
       w.is_rest
     from public.programs p
     left join public.program_versions current_version
       on current_version.id = p.current_version_id
      and current_version.program_id = p.id
     left join public.program_weeks pw
       on pw.program_version_id = current_version.id
     left join public.workouts w on w.program_week_id = pw.id
    where p.client_id = $1
      and p.coach_profile_id = $2
      and p.kind = 'client'
       and p.status <> 'archived'
      and current_version.status = 'published'
    order by p.updated_at desc, p.name, pw.week_number, w.day_of_week`,
    [clientId, coachProfileId]
  );

  const programsById = new Map();
  for (const row of programResult.rows) {
    if (!programsById.has(row.program_id)) {
      programsById.set(row.program_id, {
        id: row.program_id,
        name: row.program_name,
        currentVersionId: row.current_version_id,
        currentVersionNumber: numberValue(row.current_version_number),
        startDate: dateValue(row.start_date),
        weeks: []
      });
    }
    if (!row.week_id) continue;
    const program = programsById.get(row.program_id);
    let week = program.weeks.find(item => item.id === row.week_id);
    if (!week) {
      week = {
        id: row.week_id,
        weekNumber: Number(row.week_number),
        name: row.week_name || `Week ${row.week_number}`,
        workouts: []
      };
      program.weeks.push(week);
    }
    if (row.workout_id) {
      week.workouts.push({
        id: row.workout_id,
        name: row.workout_name || "Workout",
        dayOfWeek: Number(row.day_of_week),
        isRest: Boolean(row.is_rest)
      });
    }
  }

  const activityResult = await db.query(
    `with activity_events as (
       select
         'session:' || ws.id::text as event_key,
         ws.id as session_id,
         ws.assignment_id,
         ws.performed_on as activity_date,
         ws.status,
         ws.note,
         ws.difficulty,
         ws.energy,
         coalesce(a.workout_id, ws.workout_id) as workout_id,
         source_program.id as program_id,
         source_program.name as program_name,
         source_version.id as source_version_id,
         source_version.version_number as source_version_number
       from public.workout_sessions ws
       left join public.assignments a on a.id = ws.assignment_id
       left join public.workouts source_workout
         on source_workout.id = coalesce(a.workout_id, ws.workout_id)
       left join public.program_weeks source_week
         on source_week.id = source_workout.program_week_id
       left join public.program_versions source_version
         on source_version.id = source_week.program_version_id
       left join public.programs source_program
         on source_program.id = coalesce(source_version.program_id, ws.program_id)
        and source_program.client_id = ws.client_id
       where ws.client_id = $1
         and ws.status in ('completed', 'skipped')
       union all
       select
         'assignment:' || a.id::text as event_key,
         null::uuid as session_id,
         a.id as assignment_id,
         a.scheduled_date as activity_date,
          a.status,
         ''::text as note,
         null::integer as difficulty,
         null::integer as energy,
         a.workout_id,
         p.id as program_id,
         p.name as program_name,
         pv.id as source_version_id,
         pv.version_number as source_version_number
       from public.assignments a
       join public.workouts w on w.id = a.workout_id
       join public.program_weeks pw on pw.id = w.program_week_id
       join public.program_versions pv on pv.id = pw.program_version_id
       join public.programs p on p.id = pv.program_id
      where a.client_id = $1
         and a.status in ('skipped', 'missed')
        and p.client_id = a.client_id
        and not exists (
          select 1
            from public.workout_sessions ws
           where ws.assignment_id = a.id
        )
     ),
     recent_events as (
       select *
         from activity_events
        order by activity_date desc, event_key desc
        limit $2
     )
     select
       event.event_key,
       event.session_id,
       event.assignment_id,
       event.activity_date,
       event.status,
       event.note,
       event.difficulty,
       event.energy,
       event.workout_id,
       event.program_id,
       event.program_name,
       event.source_version_id,
       event.source_version_number,
       coalesce(nullif(btrim(workout.name), ''), 'Workout') as workout_name,
       we.id as prescribed_exercise_id,
       we.exercise_name as prescription_name,
       we.sort_order,
       we.sets as prescribed_sets,
       we.reps as prescribed_reps,
       we.duration as prescribed_duration,
       we.duration_unit as prescribed_duration_unit,
       we.distance as prescribed_distance,
       we.distance_unit as prescribed_distance_unit,
       we.load as prescribed_load,
       we.load_unit as prescribed_load_unit,
       we.rir as prescribed_rir,
       we.tempo as prescribed_tempo,
       we.notes as prescription_notes,
       se.id as session_exercise_id,
       se.activity_name as actual_activity_name,
       ss.id as session_set_id,
       ss.set_number as actual_set_number,
       ss.reps as actual_reps,
       ss.duration as actual_duration,
       ss.duration_unit as actual_duration_unit,
       ss.distance as actual_distance,
       ss.distance_unit as actual_distance_unit,
       ss.load as actual_load,
       ss.load_unit as actual_load_unit,
       ss.rir as actual_rir,
       ss.intensity as actual_intensity,
       ss.intensity_unit as actual_intensity_unit,
       ss.note as actual_set_note
     from recent_events event
     left join public.workouts workout on workout.id = event.workout_id
     left join public.workout_exercises we on we.workout_id = event.workout_id
     left join public.session_exercises se
       on se.session_id = event.session_id
      and se.workout_exercise_id = we.id
     left join public.session_sets ss on ss.session_exercise_id = se.id
     order by event.activity_date desc,
              event.event_key desc,
              we.sort_order nulls last,
              ss.set_number nulls last`,
    [clientId, RECENT_ACTIVITY_LIMIT]
  );

  const sessionsByKey = new Map();
  for (const row of activityResult.rows) {
    if (!sessionsByKey.has(row.event_key)) {
      sessionsByKey.set(row.event_key, {
        id: row.session_id || row.assignment_id,
        sessionId: row.session_id,
        assignmentId: row.assignment_id,
        performedOn: dateValue(row.activity_date),
        workoutName: row.workout_name,
        status: row.status,
        program: row.program_id
          ? {
            id: row.program_id,
            name: row.program_name,
            versionId: row.source_version_id,
            versionNumber: numberValue(row.source_version_number)
          }
          : null,
        note: row.note || "",
        difficulty: numberValue(row.difficulty),
        energy: numberValue(row.energy),
        exercises: [],
        exerciseMap: new Map()
      });
    }

    const session = sessionsByKey.get(row.event_key);
    if (!row.prescribed_exercise_id) continue;

    const exerciseKey = row.prescribed_exercise_id;
    if (!session.exerciseMap.has(exerciseKey)) {
      const exercise = {
        id: exerciseKey,
        name: row.prescription_name || row.actual_activity_name || "Activity",
        actualName: row.actual_activity_name || null,
        prescription: {
          sets: numberValue(row.prescribed_sets),
          reps: numberValue(row.prescribed_reps),
          duration: numberValue(row.prescribed_duration),
          durationUnit: row.prescribed_duration_unit || null,
          distance: numberValue(row.prescribed_distance),
          distanceUnit: row.prescribed_distance_unit || null,
          load: numberValue(row.prescribed_load),
          loadUnit: row.prescribed_load_unit || null,
          rir: numberValue(row.prescribed_rir),
          tempo: row.prescribed_tempo || null,
          notes: row.prescription_notes || ""
        },
        actualSets: [],
        actualSetNumbers: new Set()
      };
      session.exerciseMap.set(exerciseKey, exercise);
      session.exercises.push(exercise);
    }

    const exercise = session.exerciseMap.get(exerciseKey);
    if (row.session_set_id && !exercise.actualSetNumbers.has(row.actual_set_number)) {
      exercise.actualSetNumbers.add(row.actual_set_number);
      exercise.actualSets.push({
        setNumber: Number(row.actual_set_number),
        reps: numberValue(row.actual_reps),
        duration: numberValue(row.actual_duration),
        durationUnit: row.actual_duration_unit || null,
        distance: numberValue(row.actual_distance),
        distanceUnit: row.actual_distance_unit || null,
        load: numberValue(row.actual_load),
        loadUnit: row.actual_load_unit || null,
        rir: numberValue(row.actual_rir),
        intensity: numberValue(row.actual_intensity),
        intensityUnit: row.actual_intensity_unit || null,
        note: row.actual_set_note || ""
      });
    }
  }

  const recentSessions = [...sessionsByKey.values()].map(session => {
    const { exerciseMap, ...withoutMap } = session;
    return withoutMap;
  });

  return {
    client: {
      id: clientResult.rows[0].id,
      displayName: clientResult.rows[0].display_name,
      active: Boolean(clientResult.rows[0].active)
    },
    activePrograms: [...programsById.values()],
    recentSessions
  };
}

async function getProgramOverview(db, coachProfileId, programId) {
  if (!CLIENT_ID_PATTERN.test(String(programId || ""))) return null;
  const programResult = await db.query(
    `select
       p.id,
       p.name,
       p.kind,
       p.status,
       p.current_version_id,
       p.start_date,
       current_version.version_number,
       current_version.status as version_status,
       exists (
         select 1
           from public.client_access_links link
          where link.program_id = p.id
            and link.revoked_at is null
       ) as has_active_private_link
      from public.programs p
      left join public.program_versions current_version
        on current_version.id = p.current_version_id
       and current_version.program_id = p.id
     where p.id = $1
       and p.coach_profile_id = $2
     limit 1`,
    [programId, coachProfileId]
  );
  if (programResult.rowCount !== 1) return null;

  const sessionsResult = await db.query(
    `with session_events as (
       select
         ws.id as session_id,
         ws.performed_on,
         ws.status,
         ws.note,
         ws.difficulty,
         ws.energy,
         coalesce(
           a.workout_id,
           ws.workout_id,
           (
             select prescribed.workout_id
               from public.session_exercises session_exercise
               join public.workout_exercises prescribed
                 on prescribed.id = session_exercise.workout_exercise_id
              where session_exercise.session_id = ws.id
              order by prescribed.sort_order
              limit 1
           )
         ) as workout_id,
         ws.program_id
       from public.workout_sessions ws
       left join public.assignments a on a.id = ws.assignment_id
      where ws.status in ('completed', 'skipped')
        and (
          ws.program_id = $1
          or exists (
            select 1
              from public.workouts assigned_workout
              join public.program_weeks assigned_week
                on assigned_week.id = assigned_workout.program_week_id
              join public.program_versions assigned_version
                on assigned_version.id = assigned_week.program_version_id
              join public.programs assigned_program
                on assigned_program.id = assigned_version.program_id
             where assigned_workout.id = coalesce(a.workout_id, ws.workout_id)
               and assigned_program.id = $1
          )
        )
      order by ws.performed_on desc, ws.id desc
      limit $2
     )
     select
       event.session_id,
       event.performed_on,
       event.status,
       event.note,
       event.difficulty,
       event.energy,
       event.workout_id,
       workout.name as workout_name,
       version.id as version_id,
       version.version_number,
       prescribed.id as prescribed_exercise_id,
       prescribed.exercise_name as prescription_name,
       prescribed.sort_order,
       prescribed.sets as prescribed_sets,
       prescribed.reps as prescribed_reps,
       prescribed.duration as prescribed_duration,
       prescribed.duration_unit as prescribed_duration_unit,
       prescribed.distance as prescribed_distance,
       prescribed.distance_unit as prescribed_distance_unit,
       prescribed.load as prescribed_load,
       prescribed.load_unit as prescribed_load_unit,
       prescribed.rir as prescribed_rir,
       prescribed.tempo as prescribed_tempo,
       prescribed.notes as prescription_notes,
       session_exercise.id as session_exercise_id,
       session_exercise.activity_name as actual_activity_name,
       session_set.id as session_set_id,
       session_set.set_number,
       session_set.reps as actual_reps,
       session_set.duration as actual_duration,
       session_set.duration_unit as actual_duration_unit,
       session_set.distance as actual_distance,
       session_set.distance_unit as actual_distance_unit,
       session_set.load as actual_load,
       session_set.load_unit as actual_load_unit,
       session_set.rir as actual_rir,
       session_set.intensity as actual_intensity,
       session_set.intensity_unit as actual_intensity_unit,
       session_set.note as actual_set_note
      from session_events event
      left join public.workouts workout on workout.id = event.workout_id
      left join public.program_weeks week on week.id = workout.program_week_id
      left join public.program_versions version on version.id = week.program_version_id
      left join public.session_exercises session_exercise
        on session_exercise.session_id = event.session_id
      left join public.workout_exercises prescribed
        on prescribed.id = session_exercise.workout_exercise_id
      left join public.session_sets session_set
        on session_set.session_exercise_id = session_exercise.id
      order by event.performed_on desc,
               event.session_id desc,
               prescribed.sort_order nulls last,
               session_set.set_number nulls last`,
    [programId, RECENT_ACTIVITY_LIMIT]
  );

  const sessionsById = new Map();
  for (const row of sessionsResult.rows) {
    if (!sessionsById.has(row.session_id)) {
      sessionsById.set(row.session_id, {
        id: row.session_id,
        performedOn: dateValue(row.performed_on),
        workoutName: row.workout_name || "Workout",
        status: row.status,
        program: {
          id: programId,
          name: programResult.rows[0].name,
          versionId: row.version_id,
          versionNumber: numberValue(row.version_number)
        },
        note: row.note || "",
        difficulty: numberValue(row.difficulty),
        energy: numberValue(row.energy),
        exercises: [],
        exerciseMap: new Map()
      });
    }
    const session = sessionsById.get(row.session_id);
    if (!row.session_exercise_id) continue;
    const exerciseKey = row.prescribed_exercise_id || row.session_exercise_id;
    if (!session.exerciseMap.has(exerciseKey)) {
      const exercise = {
        id: exerciseKey,
        name: row.prescription_name || row.actual_activity_name || "Activity",
        actualName: row.actual_activity_name || null,
        prescription: {
          sets: numberValue(row.prescribed_sets),
          reps: numberValue(row.prescribed_reps),
          duration: numberValue(row.prescribed_duration),
          durationUnit: row.prescribed_duration_unit || null,
          distance: numberValue(row.prescribed_distance),
          distanceUnit: row.prescribed_distance_unit || null,
          load: numberValue(row.prescribed_load),
          loadUnit: row.prescribed_load_unit || null,
          rir: numberValue(row.prescribed_rir),
          tempo: row.prescribed_tempo || null,
          notes: row.prescription_notes || ""
        },
        actualSets: [],
        actualSetNumbers: new Set()
      };
      session.exerciseMap.set(exerciseKey, exercise);
      session.exercises.push(exercise);
    }
    const exercise = session.exerciseMap.get(exerciseKey);
    if (row.session_set_id && !exercise.actualSetNumbers.has(row.set_number)) {
      exercise.actualSetNumbers.add(row.set_number);
      exercise.actualSets.push({
        setNumber: Number(row.set_number),
        reps: numberValue(row.actual_reps),
        duration: numberValue(row.actual_duration),
        durationUnit: row.actual_duration_unit || null,
        distance: numberValue(row.actual_distance),
        distanceUnit: row.actual_distance_unit || null,
        load: numberValue(row.actual_load),
        loadUnit: row.actual_load_unit || null,
        rir: numberValue(row.actual_rir),
        intensity: numberValue(row.actual_intensity),
        intensityUnit: row.actual_intensity_unit || null,
        note: row.actual_set_note || ""
      });
    }
  }
  const recentSessions = [...sessionsById.values()].map(session => {
    const { exerciseMap, ...withoutMap } = session;
    return withoutMap;
  });
  const row = programResult.rows[0];
  return {
    program: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      currentVersionId: row.current_version_id,
      currentVersionNumber: numberValue(row.version_number),
      currentVersionStatus: row.version_status,
      startDate: dateValue(row.start_date),
      hasActivePrivateLink: Boolean(row.has_active_private_link)
    },
    recentSessions
  };
}

module.exports = {
  getClientOverview,
  listCoachClients,
  getProgramOverview
};
