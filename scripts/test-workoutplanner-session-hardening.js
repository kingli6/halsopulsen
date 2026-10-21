if (!process.env.WORKOUTPLANNER_TEST_DATABASE_URL) {
  throw new Error(
    "Set WORKOUTPLANNER_TEST_DATABASE_URL to the dedicated non-production database; refusing the default WorkoutPlanner URL."
  );
}
const { assertWorkoutPlannerTestTargetIsDistinct } = require("./workoutplanner-test-safety");
assertWorkoutPlannerTestTargetIsDistinct();
process.env.NODE_ENV = "test";

const assert = require("assert");
const crypto = require("crypto");
const { createRollbackTestDatabase } = require("./workoutplanner-test-transaction");
const {
  findClientDataByToken,
  hashClientAccessToken
} = require("../workoutplanner/client-access");
const {
  cloneLibraryProgramVersion,
  publishProgram,
  saveProgram
} = require("../workoutplanner/program-library");
const { saveClientSession } = require("../workoutplanner/session-logging");
const {
  getClientOverview,
  listCoachClients
} = require("../workoutplanner/coach-overview");

const REQUIRED_MIGRATIONS = [
  "012_stage1-session-integrity.sql",
  "013_prescription-names-client-identities.sql"
];

function createProgramInput(startDate, { reps, load }) {
  const days = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    enabled: false,
    name: "Rest / open day",
    exercises: []
  }));
  days[1] = {
    weekday: 1,
    enabled: true,
    name: "Strength",
    sessionType: "Strength",
    exercises: [{
      name: "Goblet squat",
      activityType: "strength",
      format: "sets",
      sets: 3,
      targetValue: reps,
      targetUnit: "reps",
      load,
      loadUnit: "kg"
    }]
  };
  days[2] = {
    weekday: 2,
    enabled: true,
    name: "Conditioning",
    sessionType: "Cardio",
    exercises: [{
      name: "Continuous bike",
      activityType: "cardio",
      format: "continuous",
      sets: 1,
      targetValue: 30,
      targetUnit: "minutes",
      durationMinutes: 30
    }]
  };
  return {
    name: "Session hardening test program",
    description: "Temporary integration-test program.",
    startDate,
    weeks: [{
      weekNumber: 1,
      name: "Week 1",
      phase: "Foundation",
      days
    }]
  };
}

async function assertRequiredMigrations(db) {
  const result = await db.query(
    `select filename
       from private.workoutplanner_schema_migrations
      where filename = any($1::text[])
      order by filename`,
    [REQUIRED_MIGRATIONS]
  );
  assert.deepStrictEqual(
    result.rows.map(row => row.filename),
    [...REQUIRED_MIGRATIONS].sort(),
    "This test requires migrations 012 and 013 to already be applied; it never applies migrations."
  );
}

async function sessionSnapshot(db, clientId) {
  const result = await db.query(
    `select ws.id as session_id,
            ws.assignment_id,
            to_char(ws.performed_on, 'YYYY-MM-DD') as performed_on,
            a.workout_id,
            pv.version_number,
            se.workout_exercise_id,
            se.activity_name,
            prescribed.sets as target_sets,
            prescribed.reps as target_reps,
            prescribed.duration as target_duration,
            prescribed.duration_unit as target_duration_unit,
            prescribed.distance as target_distance,
            prescribed.distance_unit as target_distance_unit,
            prescribed.load as target_load,
            prescribed.load_unit as target_load_unit,
            ss.set_number,
            ss.reps as actual_reps,
            ss.duration as actual_duration,
            ss.duration_unit as actual_duration_unit,
            ss.distance as actual_distance,
            ss.distance_unit as actual_distance_unit,
            ss.load as actual_load,
            ss.load_unit as actual_load_unit
       from public.workout_sessions ws
       join public.assignments a on a.id = ws.assignment_id
       join public.workouts w on w.id = a.workout_id
       join public.program_weeks pw on pw.id = w.program_week_id
       join public.program_versions pv on pv.id = pw.program_version_id
       join public.session_exercises se on se.session_id = ws.id
       join public.workout_exercises prescribed on prescribed.id = se.workout_exercise_id
       join public.session_sets ss on ss.session_exercise_id = se.id
      where ws.client_id = $1
      order by ws.performed_on, w.day_of_week, ss.set_number`,
    [clientId]
  );
  return result.rows;
}

async function run() {
  const transaction = await createRollbackTestDatabase();
  const db = transaction.database;
  try {
    await assertRequiredMigrations(db);
    const database = await db.query("select current_database() as name");
    const todayResult = await db.query("select current_date::text as today");
    const today = todayResult.rows[0].today;

    const coachResult = await db.query(
      `select id
         from public.profiles
        where role = 'coach'
        order by created_at
        limit 1`
    );
    assert.strictEqual(coachResult.rowCount, 1, "The test database needs an existing coach profile.");
    const coachId = coachResult.rows[0].id;
    const otherCoachId = crypto.randomUUID();

    const clientProfileId = crypto.randomUUID();
    const clientProfile = await db.query(
      `insert into public.profiles (id, role, display_name, clerk_user_id)
       values ($1, 'client', 'Session Hardening Test Client', null)
       returning id`,
      [clientProfileId]
    );
    assert.strictEqual(clientProfile.rowCount, 1);
    const clientResult = await db.query(
      `insert into public.clients (profile_id, display_name)
       values ($1, 'Session Hardening Test Client')
       returning id`,
      [clientProfileId]
    );
    const clientId = clientResult.rows[0].id;
    await db.query(
      `insert into public.coach_clients (coach_profile_id, client_id)
       values ($1, $2)`,
      [coachId, clientId]
    );
    const emptyHistoryProfileId = crypto.randomUUID();
    await db.query(
      `insert into public.profiles (id, role, display_name, clerk_user_id)
       values ($1, 'client', 'No History Overview Test Client', null)`,
      [emptyHistoryProfileId]
    );
    const emptyHistoryClientResult = await db.query(
      `insert into public.clients (profile_id, display_name)
       values ($1, 'No History Overview Test Client')
       returning id`,
      [emptyHistoryProfileId]
    );
    const emptyHistoryClientId = emptyHistoryClientResult.rows[0].id;
    await db.query(
      `insert into public.coach_clients (coach_profile_id, client_id)
       values ($1, $2)`,
      [coachId, emptyHistoryClientId]
    );
    const emptyHistoryOverview = await getClientOverview(db, coachId, emptyHistoryClientId);
    assert.deepStrictEqual(emptyHistoryOverview.activePrograms, []);
    assert.deepStrictEqual(emptyHistoryOverview.recentSessions, []);

    const versionOneInput = createProgramInput(today, { reps: 10, load: 20 });
    const savedLibrary = await saveProgram(db, coachId, versionOneInput);
    const sourceProgramId = savedLibrary.id || savedLibrary.programId;
    assert.ok(sourceProgramId, "The program save service should return its program identity.");
    await publishProgram(db, coachId, sourceProgramId);
    const sourceVersionResult = await db.query(
      `select id
         from public.program_versions
        where program_id = $1
          and status = 'published'`,
      [sourceProgramId]
    );
    assert.strictEqual(sourceVersionResult.rowCount, 1);

    const cloned = await cloneLibraryProgramVersion(
      db,
      coachId,
      sourceProgramId,
      sourceVersionResult.rows[0].id,
      clientId,
      versionOneInput.name
    );
    const clientProgramId = cloned.id;
    await publishProgram(db, coachId, clientProgramId);
    await db.query(
      "update public.programs set status = 'active' where id = $1",
      [clientProgramId]
    );

    const token = crypto.randomBytes(32).toString("base64url");
    const linkId = crypto.randomUUID();
    await db.query(
      `insert into public.client_access_links
        (id, client_id, program_id, token_hash, created_by)
       values ($1, $2, $3, $4, $5)`,
      [linkId, clientId, clientProgramId, hashClientAccessToken(token), coachId]
    );

    const versionOneResult = await db.query(
      `select pv.id
         from public.programs p
         join public.program_versions pv
           on pv.id = p.current_version_id
          and pv.program_id = p.id
          and pv.status = 'published'
        where p.id = $1`,
      [clientProgramId]
    );
    const assignmentsResult = await db.query(
      `select a.id as assignment_id,
              a.workout_id,
              w.name as workout_name,
              we.id as workout_exercise_id,
              we.exercise_name
         from public.assignments a
         join public.workouts w on w.id = a.workout_id
         join public.program_weeks pw on pw.id = w.program_week_id
         join public.program_versions pv on pv.id = pw.program_version_id
         join public.programs p on p.id = pv.program_id
         join public.workout_exercises we on we.workout_id = w.id
        where a.client_id = $1
          and p.id = $2
          and pv.id = $3
          and pv.version_number = 1
          and a.status = 'planned'
        order by w.day_of_week`,
      [clientId, clientProgramId, versionOneResult.rows[0].id]
    );
    assert.strictEqual(assignmentsResult.rowCount, 2, "Version 1 should publish two assigned workouts.");
    const strength = assignmentsResult.rows.find(row => row.exercise_name === "Goblet squat");
    const conditioning = assignmentsResult.rows.find(row => row.exercise_name === "Continuous bike");
    assert.ok(strength && conditioning);
    assert.notStrictEqual(strength.workout_id, conditioning.workout_id);

    for (const [assignment, sets] of [
      [strength, [{ reps: "10", load: "20", loadUnit: "kg" }]],
      [conditioning, [{ duration: "30", distance: "5", distanceUnit: "km" }]]
    ]) {
      await saveClientSession(db, token, {
        programId: clientProgramId,
        assignmentId: assignment.assignment_id,
        performedOn: today,
        exercises: [{
          workoutExerciseId: assignment.workout_exercise_id,
          sets
        }]
      });
    }

    const beforePublish = await sessionSnapshot(db, clientId);
    assert.strictEqual(beforePublish.length, 2);
    assert.strictEqual(new Set(beforePublish.map(row => row.assignment_id)).size, 2);
    assert.strictEqual(new Set(beforePublish.map(row => row.workout_id)).size, 2);
    assert.ok(beforePublish.every(row => row.performed_on === today));
    assert.ok(beforePublish.every(row => row.version_number === 1));
    const strengthResult = beforePublish.find(row => row.activity_name === "Goblet squat");
    const conditioningResult = beforePublish.find(row => row.activity_name === "Continuous bike");
    assert.strictEqual(strengthResult.target_sets, 3);
    assert.strictEqual(strengthResult.target_reps, 10);
    assert.strictEqual(Number(strengthResult.target_load), 20);
    assert.strictEqual(strengthResult.actual_reps, 10);
    assert.strictEqual(Number(strengthResult.actual_load), 20);
    assert.strictEqual(Number(conditioningResult.actual_duration), 30);
    assert.strictEqual(conditioningResult.actual_duration_unit, "minutes");
    assert.strictEqual(Number(conditioningResult.actual_distance), 5);
    assert.strictEqual(conditioningResult.actual_distance_unit, "km");

    const versionTwoInput = createProgramInput(today, { reps: 8, load: 24 });
    const savedDraft = await saveProgram(db, coachId, versionTwoInput, clientProgramId);
    assert.strictEqual(savedDraft.version, 2);
    assert.strictEqual(savedDraft.versionStatus, "draft");
    const draftOverview = await getClientOverview(db, coachId, clientId);
    assert.strictEqual(draftOverview.activePrograms[0].currentVersionId, versionOneResult.rows[0].id);
    assert.strictEqual(draftOverview.activePrograms[0].currentVersionNumber, 1);
    const draftOverviewSquat = draftOverview.recentSessions
      .flatMap(session => session.exercises)
      .find(exercise => exercise.name === "Goblet squat");
    assert.ok(
      draftOverviewSquat,
      `Coach overview should show Goblet squat history; received ${JSON.stringify(
        draftOverview.recentSessions.map(session => ({
          status: session.status,
          workoutName: session.workoutName,
          program: session.program,
          exerciseNames: session.exercises.map(exercise => exercise.name)
        }))
      )}`
    );
    assert.strictEqual(draftOverviewSquat.prescription.reps, 10);
    assert.strictEqual(draftOverviewSquat.actualSets[0].reps, 10);

    await publishProgram(db, coachId, clientProgramId);

    const afterPublish = await sessionSnapshot(db, clientId);
    assert.deepStrictEqual(
      afterPublish,
      beforePublish,
      "Publishing Version 2 must not alter the Version 1 prescription or saved results."
    );
    const currentVersion = await db.query(
      `select pv.version_number, pv.status
         from public.programs p
         join public.program_versions pv on pv.id = p.current_version_id
        where p.id = $1`,
      [clientProgramId]
    );
    assert.deepStrictEqual(currentVersion.rows[0], { version_number: 2, status: "published" });
    const currentStrength = await db.query(
      `select we.sets, we.reps, we.load, we.load_unit
         from public.program_versions pv
         join public.program_weeks pw on pw.program_version_id = pv.id
         join public.workouts w on w.program_week_id = pw.id
         join public.workout_exercises we on we.workout_id = w.id
        where pv.program_id = $1
          and pv.status = 'published'
          and we.exercise_name = 'Goblet squat'`,
      [clientProgramId]
    );
    assert.deepStrictEqual(currentStrength.rows[0], {
      sets: 3,
      reps: 8,
      load: "24.000",
      load_unit: "kg"
    });

    const clientView = await findClientDataByToken(db, token);
    const history = clientView.performanceHistory || [];
    assert.strictEqual(history.length, 2);
    const historicSquat = history.find(item => item.exerciseName === "Goblet squat");
    const historicBike = history.find(item => item.exerciseName === "Continuous bike");
    assert.ok(historicSquat && historicBike);
    assert.deepStrictEqual({
      version: historicSquat.prescription.version,
      sets: historicSquat.prescription.sets,
      reps: historicSquat.prescription.reps,
      load: Number(historicSquat.prescription.load),
      actualReps: historicSquat.sets[0].reps,
      actualLoad: Number(historicSquat.sets[0].load)
    }, {
      version: 1,
      sets: 3,
      reps: 10,
      load: 20,
      actualReps: 10,
      actualLoad: 20
    });
    assert.deepStrictEqual({
      version: historicBike.prescription.version,
      duration: historicBike.prescription.duration,
      actualDuration: Number(historicBike.sets[0].duration),
      actualDistance: Number(historicBike.sets[0].distance),
      actualDistanceUnit: historicBike.sets[0].distanceUnit
    }, {
      version: 1,
      duration: 30,
      actualDuration: 30,
      actualDistance: 5,
      actualDistanceUnit: "km"
    });
    const currentExercises = clientView.assignments.flatMap(assignment => assignment.exercises || []);
    const currentSquat = currentExercises.find(exercise => exercise.name === "Goblet squat");
    const currentBike = currentExercises.find(exercise => exercise.name === "Continuous bike");
    assert.strictEqual(
      currentSquat?.reps,
      8,
      "The current published plan should show Version 2's prescription."
    );
    assert.deepStrictEqual({
      previousReps: currentSquat.previousPerformance.sets[0].reps,
      previousLoad: Number(currentSquat.previousPerformance.sets[0].load)
    }, { previousReps: 10, previousLoad: 20 });
    assert.strictEqual(currentBike?.format, "continuous");
    assert.deepStrictEqual({
      previousDuration: Number(currentBike.previousPerformance.sets[0].duration),
      previousDistance: Number(currentBike.previousPerformance.sets[0].distance),
      previousDistanceUnit: currentBike.previousPerformance.sets[0].distanceUnit
    }, { previousDuration: 30, previousDistance: 5, previousDistanceUnit: "km" });

    const historicalOverview = await getClientOverview(db, coachId, clientId);
    const historicalSquatWorkout = historicalOverview.recentSessions.find(
      session => session.status === "completed"
        && session.exercises.some(exercise => exercise.name === "Goblet squat")
    );
    assert.ok(
      historicalSquatWorkout,
      `Historical overview should include Goblet squat: ${JSON.stringify(
        historicalOverview.recentSessions.map(session => ({
          status: session.status,
          workoutName: session.workoutName,
          program: session.program,
          exerciseNames: session.exercises.map(exercise => exercise.name)
        }))
      )}`
    );
    const historicalSquatSession = historicalSquatWorkout.exercises
      .find(exercise => exercise.name === "Goblet squat");
    assert.strictEqual(historicalSquatSession.prescription.reps, 10);
    assert.strictEqual(historicalSquatSession.prescription.load, 20);
    assert.strictEqual(historicalSquatSession.actualSets[0].reps, 10);
    assert.strictEqual(historicalSquatWorkout.program.versionNumber, 1);

    const secondClientProgram = await cloneLibraryProgramVersion(
      db,
      coachId,
      sourceProgramId,
      sourceVersionResult.rows[0].id,
      clientId,
      "Second active overview program"
    );
    await publishProgram(db, coachId, secondClientProgram.id);
    await db.query(
      "update public.programs set status = 'active' where id = $1",
      [secondClientProgram.id]
    );
    const coachClients = await listCoachClients(db, coachId);
    const listedClient = coachClients.find(client => client.id === clientId);
    assert.ok(listedClient);
    assert.strictEqual(listedClient.active, true);
    assert.strictEqual(
      listedClient.activePrograms.length,
      2,
      "The coach client list must return every active program for this client."
    );
    assert.ok(
      listedClient.activePrograms.some(
        program => program.id === clientProgramId && program.hasActivePrivateLink
      ),
      "The client list should expose the existing active private link."
    );
    assert.ok(
      listedClient.activePrograms.some(
        program => program.id === secondClientProgram.id && !program.hasActivePrivateLink
      ),
      "The client list should distinguish a program with no active private link."
    );
    assert.deepStrictEqual(await listCoachClients(db, otherCoachId), []);
    assert.strictEqual(
      await getClientOverview(db, otherCoachId, clientId),
      null,
      "A second coach must not read this client's overview."
    );

    const skippedAssignment = await db.query(
      `insert into public.assignments
         (client_id, workout_id, recommended_date, scheduled_date, status)
       values ($1, $2, current_date - 365, current_date - 365, 'skipped')
       returning id`,
      [clientId, strength.workout_id]
    );
    const skippedAssignmentId = skippedAssignment.rows[0].id;
    await db.query(
      `insert into public.workout_sessions
         (assignment_id, client_id, performed_on, status)
       values ($1, $2, current_date - 365, 'skipped')`,
      [skippedAssignmentId, clientId]
    );
    const skippedOverview = await getClientOverview(db, coachId, clientId);
    const skippedSessions = skippedOverview.recentSessions
      .filter(session => session.assignmentId === skippedAssignmentId);
    assert.strictEqual(
      skippedSessions.length,
      1,
      "A skipped assignment with a skipped session must appear once, not once per representation."
    );
    assert.strictEqual(skippedSessions[0].status, "skipped");
    assert.strictEqual(skippedSessions[0].note, "");
    assert.strictEqual(skippedSessions[0].difficulty, null);
    assert.strictEqual(skippedSessions[0].energy, null);

    const missedAssignment = await db.query(
      `insert into public.assignments
         (client_id, workout_id, recommended_date, scheduled_date, status)
       values ($1, $2, current_date - 400, current_date - 400, 'missed')
       returning id`,
      [clientId, conditioning.workout_id]
    );
    const missedAssignmentId = missedAssignment.rows[0].id;
    const missedOverview = await getClientOverview(db, coachId, clientId);
    const missedSessions = missedOverview.recentSessions
      .filter(session => session.assignmentId === missedAssignmentId);
    assert.strictEqual(
      missedSessions.length,
      1,
      "An incomplete planned workout marked missed should appear once without a session row."
    );
    assert.strictEqual(missedSessions[0].status, "missed");
    assert.strictEqual(missedSessions[0].sessionId, null);

    console.log(`WorkoutPlanner session hardening checks passed on ${database.rows[0].name}.`);
  } finally {
    await transaction.close();
  }
}

run().catch(error => {
  console.error(`WorkoutPlanner session hardening test failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
