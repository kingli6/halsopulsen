const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getPool, closePool } = require("../workoutplanner/db");
const {
  findClientDataByToken,
  regenerateClientAccessLink,
  hashClientAccessToken
} = require("../workoutplanner/client-access");
const {
  publishProgram,
  saveProgram
} = require("../workoutplanner/program-library");

function id() {
  return crypto.randomUUID();
}

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function clientProgramInput() {
  return {
    name: "Pass 1 publish update",
    description: "Database-backed client program",
    startDate: "2026-01-05",
    weeks: [{
      weekNumber: 1,
      name: "Week 1",
      phase: "Foundation",
      days: [
        { weekday: 0, enabled: false, exercises: [] },
        { weekday: 1, enabled: true, name: "Updated Monday", sessionType: "Strength", exercises: [{
          name: "Updated squat",
          activityType: "strength",
          sets: 3,
          targetValue: 8,
          targetUnit: "reps"
        }] },
        { weekday: 2, enabled: false, exercises: [] },
        { weekday: 3, enabled: true, name: "Updated Wednesday", sessionType: "Cardio", exercises: [{
          name: "Updated walk",
          activityType: "cardio",
          format: "continuous",
          targetValue: 30,
          targetUnit: "minutes"
        }] },
        { weekday: 4, enabled: false, exercises: [] },
        { weekday: 5, enabled: false, exercises: [] },
        { weekday: 6, enabled: false, exercises: [] }
      ]
    }]
  };
}

async function run() {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const editorSource = fs.readFileSync(path.join(__dirname, "..", "dashboard", "plan.js"), "utf8");
  assert.match(serverSource, /app\.post\('\/api\/workoutplanner\/programs\/:programId\/publish', requireWorkoutPlannerOwner/);
  assert.match(editorSource, /\/api\/workoutplanner\/programs\/\$\{encodeURIComponent\(planState\.databaseProgramId\)\}\/publish/);
  assert.match(editorSource, /databaseProgramKind === "client"/);

  const pool = getPool();
  const fixture = {
    coachId: null,
    otherCoachId: id(),
    clientProfileId: id(),
    clientId: null,
    programId: null,
    versionOneId: null,
    firstWorkoutId: null,
    exerciseIds: [],
    tokenHash: null
  };

  try {
    const coachResult = await pool.query(
      `select id from public.profiles where role = 'coach' order by created_at limit 1`
    );
    assert.strictEqual(coachResult.rowCount, 1, "The real WorkoutPlanner database needs one coach.");
    fixture.coachId = coachResult.rows[0].id;

    await pool.query(
      `insert into public.profiles (id, role, display_name, clerk_user_id)
       values ($1, 'coach', 'Pass 1 unauthorized coach', $2)`,
      [fixture.otherCoachId, `user_publish_test_${fixture.otherCoachId.replaceAll("-", "")}`]
    );
    await pool.query(
      `insert into public.profiles (id, role, display_name, clerk_user_id)
       values ($1, 'client', 'Pass 1 publish client', null)`,
      [fixture.clientProfileId]
    );
    const clientResult = await pool.query(
      `insert into public.clients (profile_id, display_name)
       values ($1, 'Pass 1 publish client')
       returning id`,
      [fixture.clientProfileId]
    );
    fixture.clientId = clientResult.rows[0].id;
    await pool.query(
      `insert into public.coach_clients (coach_profile_id, client_id)
       values ($1, $2)`,
      [fixture.coachId, fixture.clientId]
    );

    const programResult = await pool.query(
      `insert into public.programs
        (coach_profile_id, client_id, kind, name, description, status, start_date)
       values ($1, $2, 'client', 'Pass 1 publish program', '', 'active', '2026-01-05')
       returning id`,
      [fixture.coachId, fixture.clientId]
    );
    fixture.programId = programResult.rows[0].id;
    const versionResult = await pool.query(
      `insert into public.program_versions
        (program_id, version_number, status, created_by)
       values ($1, 1, 'draft', $2)
       returning id`,
      [fixture.programId, fixture.coachId]
    );
    fixture.versionOneId = versionResult.rows[0].id;
    const weekResult = await pool.query(
      `insert into public.program_weeks
        (program_version_id, week_number, name)
       values ($1, 1, 'Week 1')
       returning id`,
      [fixture.versionOneId]
    );
    const exerciseResult = await pool.query(
      `insert into public.exercises (name, category)
       values ('Pass 1 squat', 'strength')
       returning id`
    );
    fixture.exerciseIds.push(exerciseResult.rows[0].id);

    for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
      const workoutResult = await pool.query(
        `insert into public.workouts
          (program_week_id, day_of_week, name, session_type, is_rest)
         values ($1, $2, $3, 'Other', $4)
         returning id`,
        [weekResult.rows[0].id, dayOfWeek, dayOfWeek === 1 ? "Initial Monday" : `Rest ${dayOfWeek}`, dayOfWeek !== 1]
      );
      if (dayOfWeek === 1) {
        fixture.firstWorkoutId = workoutResult.rows[0].id;
        await pool.query(
          `insert into public.workout_exercises
            (workout_id, exercise_id, sort_order, sets, reps)
           values ($1, $2, 1, 3, 8)`,
          [fixture.firstWorkoutId, fixture.exerciseIds[0]]
        );
      }
    }

    const link = await regenerateClientAccessLink(
      pool,
      fixture.coachId,
      fixture.clientId,
      fixture.programId
    );
    fixture.tokenHash = hashClientAccessToken(link.token);
    const firstPublish = await publishProgram(pool, fixture.coachId, fixture.programId);
    assert.strictEqual(firstPublish.version, 1);
    assert.strictEqual(firstPublish.versionStatus, "published");
    assert.strictEqual(firstPublish.publishedAssignmentCount, 1);

    const firstVersion = await pool.query(
      `select status, published_at from public.program_versions where id = $1`,
      [fixture.versionOneId]
    );
    assert.strictEqual(firstVersion.rows[0].status, "published");
    assert.ok(firstVersion.rows[0].published_at);
    const firstAssignment = await pool.query(
      `select recommended_date, scheduled_date, status, moved, workout_id
         from public.assignments
        where client_id = $1 and workout_id = $2`,
      [fixture.clientId, fixture.firstWorkoutId]
    );
    assert.deepStrictEqual({
      ...firstAssignment.rows[0],
      recommended_date: dateOnly(firstAssignment.rows[0].recommended_date),
      scheduled_date: dateOnly(firstAssignment.rows[0].scheduled_date)
    }, {
      recommended_date: "2026-01-05",
      scheduled_date: "2026-01-05",
      status: "planned",
      moved: false,
      workout_id: fixture.firstWorkoutId
    });

    const firstClientView = await findClientDataByToken(pool, link.token);
    assert.strictEqual(firstClientView.program.id, fixture.programId);
    assert.strictEqual(firstClientView.assignments.length, 1);
    assert.strictEqual(firstClientView.assignments[0].workout_name, "Initial Monday");

    const savedDraft = await saveProgram(pool, fixture.coachId, clientProgramInput(), fixture.programId);
    assert.strictEqual(savedDraft.version, 2);
    assert.strictEqual(savedDraft.versionStatus, "draft");
    const draftVersion = await pool.query(
      `select id, status from public.program_versions where program_id = $1 and version_number = 2`,
      [fixture.programId]
    );
    assert.strictEqual(draftVersion.rows[0].status, "draft");

    const draftClientView = await findClientDataByToken(pool, link.token);
    assert.strictEqual(draftClientView.program.id, fixture.programId);
    assert.strictEqual(draftClientView.assignments.length, 1);
    assert.strictEqual(draftClientView.assignments[0].workout_name, "Initial Monday");

    await assert.rejects(
      () => publishProgram(pool, fixture.otherCoachId, fixture.programId),
      error => error.statusCode === 404
    );
    const stillDraft = await pool.query(
      `select status from public.program_versions where id = $1`,
      [draftVersion.rows[0].id]
    );
    assert.strictEqual(stillDraft.rows[0].status, "draft");

    const secondPublish = await publishProgram(pool, fixture.coachId, fixture.programId);
    assert.strictEqual(secondPublish.version, 2);
    assert.strictEqual(secondPublish.versionStatus, "published");
    assert.strictEqual(secondPublish.publishedAssignmentCount, 2);

    const versionStatuses = await pool.query(
      `select version_number, status
         from public.program_versions
        where program_id = $1
        order by version_number`,
      [fixture.programId]
    );
    assert.deepStrictEqual(versionStatuses.rows, [
      { version_number: 1, status: "archived" },
      { version_number: 2, status: "published" }
    ]);
    const oldAssignment = await pool.query(
      `select status, moved from public.assignments where workout_id = $1`,
      [fixture.firstWorkoutId]
    );
    assert.deepStrictEqual(oldAssignment.rows[0], { status: "planned", moved: false });

    const finalClientView = await findClientDataByToken(pool, link.token);
    assert.strictEqual(finalClientView.program.id, fixture.programId);
    assert.strictEqual(finalClientView.assignments.length, 2);
    assert.ok(finalClientView.assignments.some(item => item.workout_name === "Updated Monday"));
    assert.ok(finalClientView.assignments.some(item => item.workout_name === "Updated Wednesday"));
    const linkRow = await pool.query(
      `select program_id from public.client_access_links where token_hash = $1`,
      [fixture.tokenHash]
    );
    assert.strictEqual(linkRow.rows[0].program_id, fixture.programId);

    const assignmentCount = await pool.query(
      `select count(*)::int as count from public.assignments where client_id = $1`,
      [fixture.clientId]
    );
    assert.strictEqual(Number(assignmentCount.rows[0].count), 3);
    console.log("WorkoutPlanner database publish checks passed.");
  } finally {
    if (fixture.clientId) {
      await pool.query(`delete from public.assignments where client_id = $1`, [fixture.clientId]).catch(() => {});
      await pool.query(`delete from public.client_access_links where client_id = $1`, [fixture.clientId]).catch(() => {});
    }
    if (fixture.programId) {
      await pool.query(`delete from public.programs where id = $1`, [fixture.programId]).catch(() => {});
    }
    if (fixture.clientId) {
      await pool.query(`delete from public.coach_clients where client_id = $1`, [fixture.clientId]).catch(() => {});
      await pool.query(`delete from public.clients where id = $1`, [fixture.clientId]).catch(() => {});
    }
    await pool.query(`delete from public.profiles where id = $1`, [fixture.clientProfileId]).catch(() => {});
    await pool.query(`delete from public.profiles where id = $1`, [fixture.otherCoachId]).catch(() => {});
    for (const exerciseId of fixture.exerciseIds) {
      await pool.query(`delete from public.exercises where id = $1`, [exerciseId]).catch(() => {});
    }
    await closePool();
  }
}

run().catch(error => {
  console.error(`WorkoutPlanner publish test failed: ${error.message}`);
  process.exitCode = 1;
});