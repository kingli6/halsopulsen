const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  normalizeSessionEntries,
  saveClientSession
} = require("../workoutplanner/session-logging");

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";
const WORKOUT_ID = "44444444-4444-4444-8444-444444444444";
const WORKOUT_EXERCISE_ID = "55555555-5555-4555-8555-555555555555";
const IDENTITY_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_ID = "77777777-7777-4777-8777-777777777777";
const SESSION_EXERCISE_ID = "88888888-8888-4888-8888-888888888888";

function createFakePool({ scopeAvailable = true, assignmentAvailable = true } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
      calls.push({ sql: normalized, values });
      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        return { rowCount: 0, rows: [] };
      }
      if (normalized.includes("from public.client_access_links l")) {
        return scopeAvailable
          ? { rowCount: 1, rows: [{ client_id: CLIENT_ID, program_id: PROGRAM_ID }] }
          : { rowCount: 0, rows: [] };
      }
      if (normalized.includes("from public.assignments a")) {
        return assignmentAvailable
          ? { rowCount: 1, rows: [{ id: ASSIGNMENT_ID, client_id: CLIENT_ID, workout_id: WORKOUT_ID, program_id: PROGRAM_ID }] }
          : { rowCount: 0, rows: [] };
      }
      if (normalized.includes("from public.workout_sessions") && normalized.includes("where assignment_id")) {
        return { rowCount: 0, rows: [] };
      }
      if (normalized.startsWith("select id, exercise_name, sort_order")) {
        return {
          rowCount: 1,
          rows: [{
            id: WORKOUT_EXERCISE_ID,
            exercise_name: "Goblet squat",
            sort_order: 2,
            duration_unit: null,
            distance_unit: null,
            load_unit: "kg"
          }]
        };
      }
      if (normalized.startsWith("insert into public.client_exercises")) {
        return { rowCount: 1, rows: [{ id: IDENTITY_ID }] };
      }
      if (normalized.startsWith("insert into public.workout_sessions")) {
        return { rowCount: 1, rows: [{ id: SESSION_ID }] };
      }
      if (normalized.startsWith("insert into public.session_exercises")) {
        return { rowCount: 1, rows: [{ id: SESSION_EXERCISE_ID }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  return { calls, connect: async () => client };
}

async function expectStatus(promise, statusCode) {
  await assert.rejects(promise, error => error.statusCode === statusCode);
}

async function run() {
  const normalized = normalizeSessionEntries({
    exercises: [{
      workoutExerciseId: WORKOUT_EXERCISE_ID,
      sets: [
        { reps: "", load: "", loadUnit: "kg" },
        { reps: "8", load: "42.5", loadUnit: "kg" }
      ]
    }]
  });
  assert.deepStrictEqual(normalized, [{
    workoutExerciseId: WORKOUT_EXERCISE_ID,
    sets: [{
      setNumber: 2,
      reps: 8,
      duration: null,
      distance: null,
      load: 42.5,
      loadUnit: "kg"
    }]
  }]);
  assert.throws(
    () => normalizeSessionEntries({ exercises: [{ workoutExerciseId: WORKOUT_EXERCISE_ID, sets: [{ reps: "-1" }] }] }),
    error => error.statusCode === 400
  );
  assert.throws(
    () => normalizeSessionEntries({ exercises: [{ workoutExerciseId: WORKOUT_EXERCISE_ID, sets: [{ load: "30" }] }] }),
    error => error.statusCode === 400
  );
  assert.throws(
    () => normalizeSessionEntries({ exercises: [{ workoutExerciseId: WORKOUT_EXERCISE_ID, sets: [{ reps: "" }] }] }),
    error => error.statusCode === 400
  );

  const pool = createFakePool();
  const saved = await saveClientSession(pool, "test-private-token", {
    programId: PROGRAM_ID,
    assignmentId: ASSIGNMENT_ID,
    performedOn: "2026-10-13",
    exercises: [{
      workoutExerciseId: WORKOUT_EXERCISE_ID,
      sets: [{ reps: "8", load: "42.5", loadUnit: "kg" }]
    }]
  });
  assert.deepStrictEqual(saved, { id: SESSION_ID, clientId: CLIENT_ID, programId: PROGRAM_ID });
  assert.ok(pool.calls.some(call =>
    call.sql.startsWith("insert into public.workout_exercises") === false
    && call.sql.startsWith("insert into public.exercises") === false
  ));
  assert.ok(pool.calls.some(call =>
    call.sql.startsWith("insert into public.session_exercises")
    && call.values[1] === WORKOUT_EXERCISE_ID
    && call.values[2] === IDENTITY_ID
    && call.values[3] === "Goblet squat"
  ), "The session must link the exact prescription and retain its name snapshot.");
  assert.ok(pool.calls.some(call =>
    call.sql.startsWith("insert into public.session_sets")
    && call.values[2] === 8
    && call.values[7] === 42.5
    && call.values[8] === "kg"
  ), "Only actual values and their units should be saved.");
  assert.ok(pool.calls.some(call => call.sql === "commit"));
  assert.ok(!pool.calls.some(call => call.sql.includes("insert into public.exercises ")));

  const genericLinkPool = createFakePool({ scopeAvailable: false });
  await expectStatus(saveClientSession(genericLinkPool, "generic-library-token", {
    programId: PROGRAM_ID,
    assignmentId: ASSIGNMENT_ID,
    performedOn: "2026-10-13",
    exercises: [{ workoutExerciseId: WORKOUT_EXERCISE_ID, sets: [{ reps: "8" }] }]
  }), 403);
  assert.ok(!genericLinkPool.calls.some(call => call.sql.startsWith("insert into public.workout_sessions")));
  assert.ok(genericLinkPool.calls.some(call => call.sql === "rollback"));

  const wrongAssignmentPool = createFakePool({ assignmentAvailable: false });
  await expectStatus(saveClientSession(wrongAssignmentPool, "client-private-token", {
    programId: PROGRAM_ID,
    assignmentId: ASSIGNMENT_ID,
    performedOn: "2026-10-13",
    exercises: [{ workoutExerciseId: WORKOUT_EXERCISE_ID, sets: [{ reps: "8" }] }]
  }), 403);
  assert.ok(!wrongAssignmentPool.calls.some(call => call.sql.startsWith("insert into public.workout_sessions")));

  const programLibrary = fs.readFileSync(
    path.join(__dirname, "..", "workoutplanner", "program-library.js"),
    "utf8"
  );
  const saveStart = programLibrary.indexOf("async function saveProgram(");
  const cloneStart = programLibrary.indexOf("async function cloneLibraryProgramVersion(");
  assert.ok(saveStart >= 0 && cloneStart > saveStart, "Program save and clone paths must remain identifiable.");
  assert.doesNotMatch(programLibrary.slice(saveStart, cloneStart), /insert\s+into\s+public\.exercises\b/i);
  assert.doesNotMatch(programLibrary.slice(cloneStart), /insert\s+into\s+public\.exercises\b/i);

  const clientAccess = fs.readFileSync(
    path.join(__dirname, "..", "workoutplanner", "client-access.js"),
    "utf8"
  );
  assert.match(clientAccess, /ce\.client_id = \$1[\s\S]*?ws\.client_id = \$1[\s\S]*?previousPerformance/);
  assert.match(clientAccess, /'name', we\.exercise_name/);

  const clientUi = fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.js"), "utf8");
  assert.match(clientUi, /data-use-previous/);
  assert.match(clientUi, /function copyPreviousValues/);
  assert.match(clientUi, /value="" inputmode="decimal"/);
  assert.match(clientUi, /Use previous values/);
  assert.match(clientUi, /programId: clientPage\.data\.program\.id/);
  assert.doesNotMatch(clientUi, /No previous performance recorded/);

  const planUi = fs.readFileSync(path.join(__dirname, "..", "dashboard", "plan.js"), "utf8");
  assert.doesNotMatch(planUi, /activityTemplateLibrarySelect|activityTemplateList|useActivityTemplateBtn|saveTemplate\("activity"/);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /new Set\(\['workout', 'week'\]\)/);
  assert.match(server, /\.filter\(template => template\.type === 'workout' \|\| template\.type === 'week'\)/);
  assert.match(server, /app\.post\('\/api\/client\/:token\/sessions'/);

  console.log("WorkoutPlanner session logging database-free checks passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
