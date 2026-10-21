const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  listProgramVersions,
  listPrograms,
  loadProgram
} = require("../workoutplanner/program-library");

const coachId = "11111111-1111-4111-8111-111111111111";
const programId = "22222222-2222-4222-8222-222222222222";

function createDb(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      const call = { sql: String(sql), values };
      calls.push(call);
      return handler(call, calls.length);
    }
  };
}

async function testDatabaseBackedVersionCounts() {
  const db = createDb(() => ({
    rows: [{
      id: programId,
      client_id: null,
      person_name: "",
      kind: "library",
      source_program_id: null,
      source_version_id: null,
      version_id: "33333333-3333-4333-8333-333333333333",
      revision: 3,
      current_version_id: "44444444-4444-4444-8444-444444444444",
      current_version_number: 3,
      name: "Strength plan",
      description: "",
      status: "active",
      start_date: "2026-10-01",
      published_start_date: "2026-10-01",
      updated_at: "2026-10-20T12:00:00.000Z",
      version_number: 4,
      version_status: "draft",
      has_active_private_link: false,
      has_current_version: true,
      has_published_version: true,
      published_version_count: 2,
      archived_version_count: 1,
      week_count: 4
    }],
    rowCount: 1
  }));

  const programs = await listPrograms(db, coachId);
  assert.strictEqual(programs.length, 1);
  assert.strictEqual(programs[0].publishedVersionCount, 2);
  assert.strictEqual(programs[0].archivedVersionCount, 1);
  assert.strictEqual(programs[0].hasPublishedVersion, true);

  const query = db.calls[0].sql;
  assert.match(query, /counted_version\.status = 'published'/i);
  assert.match(query, /counted_version\.status = 'archived'/i);
  assert.match(
    query,
    /published_version\.status in \('published',\s*'archived'\)/i,
    "Historical published versions should still count as evidence that a program was published."
  );
}

async function testVersionHistorySeparatesStatuses() {
  const db = createDb(() => ({
    rows: [
      { id: "55555555-5555-4555-8555-555555555555", version_number: 3, status: "published" },
      { id: "66666666-6666-4666-8666-666666666666", version_number: 2, status: "archived" }
    ],
    rowCount: 2
  }));
  const versions = await listProgramVersions(db, coachId, programId);
  assert.deepStrictEqual(versions.map(version => version.status), ["published", "archived"]);
  assert.match(db.calls[0].sql, /pv\.status in \('published',\s*'archived'\)/i);
}

async function testSavedDraftLoadsPrescriptionName() {
  const db = createDb(() => ({
    rows: [{
      program_id: programId,
      client_id: null,
      program_name: "Draft strength plan",
      program_description: "",
      person_name: "",
      program_status: "draft",
      program_kind: "library",
      source_program_id: null,
      source_version_id: null,
      current_version_id: null,
      program_revision: 0,
      program_updated_at: "2026-10-20T12:00:00.000Z",
      start_date: null,
      version_id: "33333333-3333-4333-8333-333333333333",
      version_number: 1,
      version_status: "draft",
      week_id: "week-a",
      week_number: 1,
      week_name: "Foundation",
      phase: "Foundation",
      progression_notes: "",
      success_metric: "",
      workout_id: "55555555-5555-4555-8555-555555555555",
      day_of_week: 2,
      workout_name: "Lower body",
      workout_description: "",
      session_type: "Strength",
      warmup: "",
      cooldown: "",
      is_rest: false,
      workout_exercise_id: "66666666-6666-4666-8666-666666666666",
      sort_order: 1,
      exercise_id: null,
      sets: 3,
      reps: 8,
      duration: null,
      duration_unit: null,
      distance: null,
      distance_unit: null,
      load: null,
      load_unit: "kg",
      rir: null,
      tempo: null,
      rest_seconds: 60,
      intensity: null,
      intensity_unit: null,
      work_seconds: null,
      recovery_seconds: null,
      rounds: null,
      notes: "",
      resource_url: null,
      planner_metadata: { activityType: "strength", format: "sets", targetUnit: "reps" },
      exercise_name: "Goblet squat",
      legacy_exercise_name: null,
      category: "strength",
      current_version_number: null
    }],
    rowCount: 1
  }));

  const loaded = await loadProgram(db, coachId, programId);
  assert.strictEqual(loaded.versionStatus, "draft");
  assert.strictEqual(loaded.program.days[2].exercises[0].name, "Goblet squat");
  assert.match(db.calls[0].sql, /we\.exercise_name/i);
  assert.match(db.calls[0].sql, /e\.name as legacy_exercise_name/i);
}

function testProgramPublishAndDashboardContracts() {
  const programLibrary = fs.readFileSync(
    path.join(__dirname, "..", "workoutplanner", "program-library.js"),
    "utf8"
  );
  const publishImplementation = programLibrary.slice(
    programLibrary.indexOf("async function publishProgram"),
    programLibrary.indexOf("async function cloneLibraryProgramVersion")
  );
  assert.match(
    publishImplementation,
    /status = case when kind = 'client' then 'active' else status end/i,
    "Publishing a client program must activate its parent program."
  );

  const planner = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "plan.js"),
    "utf8"
  );
  const libraryRenderer = planner.slice(
    planner.indexOf("function renderDatabaseProgramLibrary"),
    planner.indexOf("async function loadDatabaseLibrary")
  );
  assert.match(libraryRenderer, /planState\.databasePrograms/);
  assert.match(libraryRenderer, /program\.publishedVersionCount/);
  assert.match(libraryRenderer, /program\.archivedVersionCount/);
  assert.doesNotMatch(libraryRenderer, /planState\.library/);

  const librarySummary = planner.slice(
    planner.indexOf("function renderLibrarySummary"),
    planner.indexOf("function renderPlanOverview")
  );
  assert.match(librarySummary, /databaseWorkspace[\s\S]*planState\.databasePrograms/);
  assert.match(librarySummary, /: planState\.library\.length/);

  const cloneFlow = planner.slice(
    planner.indexOf("async function createClientDatabaseProgram"),
    planner.indexOf("async function toggleProgramVersionHistory")
  );
  assert.match(cloneFlow, /\/api\/workoutplanner\/programs\/\$\{encodeURIComponent\(programId\)\}\/clone/);
  assert.match(cloneFlow, /fresh\.publishedProgram = null/);
  assert.doesNotMatch(cloneFlow, /\/publish|assignments/i);
}

async function run() {
  await testDatabaseBackedVersionCounts();
  await testVersionHistorySeparatesStatuses();
  await testSavedDraftLoadsPrescriptionName();
  testProgramPublishAndDashboardContracts();
  console.log("WorkoutPlanner program-library checks passed.");
}

run().catch(error => {
  console.error(`WorkoutPlanner program-library checks failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
