const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const {
  findClientDataByToken,
  hashClientAccessToken
} = require("../workoutplanner/client-access");
const { saveClientSession } = require("../workoutplanner/session-logging");

const migrationName = "013_prescription-names-client-identities.sql";
const migrationPath = path.join(
  __dirname,
  "..",
  "db",
  "workoutplanner-migrations",
  migrationName
);

function requiredTestConnectionString() {
  const connectionString = process.env.WORKOUTPLANNER_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Set WORKOUTPLANNER_TEST_DATABASE_URL to a dedicated non-production WorkoutPlanner database. The shared WorkoutPlanner URL is never used by this test."
    );
  }
  return connectionString;
}

async function migrationStatus(client, filename) {
  const result = await client.query(
    "select 1 from private.workoutplanner_schema_migrations where filename = $1",
    [filename]
  );
  return result.rowCount === 1;
}

async function snapshotExistingPerformance(client) {
  const [sessions, exercises, sets] = await Promise.all([
    client.query(
      `select id, client_id
         from public.workout_sessions
        order by id`
    ),
    client.query(
      `select id, activity_name
         from public.session_exercises
        order by id`
    ),
    client.query(
      `select id, session_exercise_id, set_number, reps, duration, duration_unit,
              distance, distance_unit, load, load_unit, rir, intensity, intensity_unit,
              completed, note, created_at, updated_at
         from public.session_sets
        order by id`
    )
  ]);
  return {
    sessions: sessions.rows,
    exercises: exercises.rows,
    sets: sets.rows
  };
}

async function applyForwardMigrationIfNeeded(client) {
  const hasStage1 = await migrationStatus(client, "012_stage1-session-integrity.sql");
  if (!hasStage1) {
    throw new Error("The test database must already be at migration 012; this test will not run or replay migration 012.");
  }
  if (await migrationStatus(client, migrationName)) return false;

  const before = await snapshotExistingPerformance(client);
  await client.query(fs.readFileSync(migrationPath, "utf8"));
  await client.query(
    "insert into private.workoutplanner_schema_migrations (filename) values ($1)",
    [migrationName]
  );
  const after = await snapshotExistingPerformance(client);

  assert.deepStrictEqual(after.sessions, before.sessions, "Migration must preserve session IDs and client scope.");
  assert.deepStrictEqual(after.sets, before.sets, "Migration must preserve all historical set values.");
  const preservedNames = new Map(before.exercises
    .filter(row => String(row.activity_name || "").trim())
    .map(row => [row.id, row.activity_name]));
  for (const row of after.exercises) {
    if (preservedNames.has(row.id)) {
      assert.strictEqual(row.activity_name, preservedNames.get(row.id), "Existing nonblank name snapshots must remain unchanged.");
    }
  }
  return true;
}

async function assertMigratedSchema(client) {
  const nameColumn = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'workout_exercises'
        and column_name = 'exercise_name'`
  );
  const identityTable = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'client_exercises'`
  );
  const activitySourceColumn = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'workout_exercises'
        and column_name = 'activity_source'`
  );
  const unlinkedClientRows = await client.query(
    `select count(*)::int as count
       from public.session_exercises se
       join public.workout_sessions ws on ws.id = se.session_id
      where ws.client_id is not null
        and se.client_exercise_id is null`
  );
  const mismatchedIdentityRows = await client.query(
    `select count(*)::int as count
       from public.session_exercises se
       join public.workout_sessions ws on ws.id = se.session_id
       join public.client_exercises ce on ce.id = se.client_exercise_id
      where ws.client_id is not null
        and ce.client_id <> ws.client_id`
  );
  assert.strictEqual(nameColumn.rowCount, 1, "Prescription name column should exist.");
  assert.strictEqual(identityTable.rowCount, 1, "Client-scoped identity table should exist.");
  assert.strictEqual(activitySourceColumn.rowCount, 0, "No activity_source column should be added.");
  assert.strictEqual(unlinkedClientRows.rows[0].count, 0, "Historical client sessions should have identities.");
  assert.strictEqual(mismatchedIdentityRows.rows[0].count, 0, "A client must never reference another client's identity.");
}

async function verifySessionLogging(pool, client) {
  const assignmentResult = await client.query(
    `select p.client_id, w.id as workout_id, p.id as program_id,
            p.coach_profile_id, we.id as workout_exercise_id
       from public.programs p
       join public.clients c on c.id = p.client_id and c.active = true
       join public.program_versions pv
         on pv.id = p.current_version_id
        and pv.program_id = p.id
        and pv.status = 'published'
       join public.program_weeks pw on pw.program_version_id = pv.id
       join public.workouts w on w.program_week_id = pw.id
       join public.workout_exercises we on we.workout_id = w.id
      where p.kind = 'client'
        and p.coach_profile_id is not null
        and not exists (
          select 1
            from public.client_access_links active_link
           where active_link.program_id = p.id
             and active_link.revoked_at is null
        )
      order by p.updated_at desc, w.day_of_week, we.sort_order
      limit 1`
  );
  if (assignmentResult.rowCount !== 1) {
    throw new Error("The dedicated test database needs an active client program, a prescribed exercise, and no active bearer link for that program.");
  }
  const fixture = assignmentResult.rows[0];
  const assignmentDateResult = await client.query("select current_date::text as today");
  const performedOn = assignmentDateResult.rows[0].today;
  let assignmentId = null;
  const linkId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  let linkCreated = false;
  let existingIdentity = { rowCount: 0, rows: [] };
  let sessionId = null;
  let identityId = null;
  try {
    const assignmentInsert = await client.query(
      `insert into public.assignments
         (client_id, workout_id, recommended_date, scheduled_date)
       values ($1, $2, $3::date, $3::date)
       returning id`,
      [fixture.client_id, fixture.workout_id, performedOn]
    );
    assignmentId = assignmentInsert.rows[0].id;
    await client.query(
      `insert into public.client_access_links
         (id, client_id, program_id, token_hash, created_by)
       values ($1, $2, $3, $4, $5)`,
      [linkId, fixture.client_id, fixture.program_id, hashClientAccessToken(token), fixture.coach_profile_id]
    );
    linkCreated = true;
    existingIdentity = await client.query(
      `select id from public.client_exercises
        where client_id = $1
          and normalized_name = (
            select lower(btrim(exercise_name))
              from public.workout_exercises
             where id = $2
          )`,
      [fixture.client_id, fixture.workout_exercise_id]
    );

    const saved = await saveClientSession(pool, token, {
      programId: fixture.program_id,
      assignmentId,
      performedOn,
      exercises: [{
        workoutExerciseId: fixture.workout_exercise_id,
        sets: [{ reps: "1" }]
      }]
    });
    sessionId = saved.id;

    const savedExercise = await client.query(
      `select se.workout_exercise_id, se.client_exercise_id, se.activity_name,
              ce.client_id, ss.reps
         from public.session_exercises se
         join public.client_exercises ce on ce.id = se.client_exercise_id
         join public.session_sets ss on ss.session_exercise_id = se.id
        where se.session_id = $1`,
      [sessionId]
    );
    assert.strictEqual(savedExercise.rowCount, 1);
    assert.strictEqual(savedExercise.rows[0].workout_exercise_id, fixture.workout_exercise_id);
    assert.strictEqual(savedExercise.rows[0].client_id, fixture.client_id);
    assert.strictEqual(savedExercise.rows[0].reps, 1);
    identityId = savedExercise.rows[0].client_exercise_id;

    const clientData = await findClientDataByToken(pool, token);
    assert.ok(clientData && !clientData.directProgram);
    const loggedExercise = (clientData.performanceHistory || []).find(item =>
      item.sessionId === sessionId && item.clientExerciseId === identityId
    );
    assert.ok(loggedExercise, "Saved session should appear in the scoped performance history.");
    assert.strictEqual(loggedExercise.exerciseName, savedExercise.rows[0].activity_name);
    const plannedExercise = clientData.assignments
      .find(item => item.id === assignmentId)
      ?.exercises.find(item => item.id === fixture.workout_exercise_id);
    assert.ok(plannedExercise?.previousPerformance, "Today's saved values should become the next previous-performance reference.");
    assert.strictEqual(plannedExercise.previousPerformance.sets[0].reps, 1);
  } finally {
    if (sessionId) {
      await client.query("delete from public.workout_sessions where id = $1", [sessionId]);
    }
    if (identityId && existingIdentity.rowCount === 0) {
      await client.query(
        `delete from public.client_exercises ce
          where ce.id = $1
            and not exists (
              select 1 from public.session_exercises se
               where se.client_exercise_id = ce.id
            )`,
        [identityId]
      );
    }
    if (linkCreated) {
      await client.query("delete from public.client_access_links where id = $1", [linkId]);
    }
    if (assignmentId) {
      await client.query("delete from public.assignments where id = $1", [assignmentId]);
    }
  }
}

async function run() {
  const pool = new Pool({
    connectionString: requiredTestConnectionString(),
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 10000
  });
  let client;
  try {
    client = await pool.connect();
    const database = await client.query("select current_database() as name");
    console.log(`WorkoutPlanner integration test using dedicated test database: ${database.rows[0].name}`);
    const applied = await applyForwardMigrationIfNeeded(client);
    await assertMigratedSchema(client);
    client.release();
    client = null;

    const beforeCatalog = await pool.query("select count(*)::int as count from public.exercises");
    const fixtureClient = await pool.connect();
    try {
      await verifySessionLogging(pool, fixtureClient);
    } finally {
      fixtureClient.release();
    }
    const afterCatalog = await pool.query("select count(*)::int as count from public.exercises");
    assert.strictEqual(afterCatalog.rows[0].count, beforeCatalog.rows[0].count, "Session logging must not create global exercise records.");
    console.log(applied
      ? "WorkoutPlanner migration 013 and session logging integration checks passed."
      : "WorkoutPlanner session logging integration checks passed; migration 013 was already applied.");
  } finally {
    client?.release();
    await pool.end();
  }
}

run().catch(error => {
  console.error(`WorkoutPlanner non-production integration test failed: ${error.message}`);
  process.exitCode = 1;
});
