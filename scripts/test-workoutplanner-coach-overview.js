const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  getClientOverview,
  listCoachClients
} = require("../workoutplanner/coach-overview");
const {
  buildClientSummary,
  tryCopyToClipboard
} = require("../dashboard/client-summary");

const coachId = "coach-a";
const clientId = "11111111-1111-4111-8111-111111111111";
const otherClientId = "22222222-2222-4222-8222-222222222222";
const programId = "33333333-3333-4333-8333-333333333333";
const currentVersionId = "44444444-4444-4444-8444-444444444444";
const sessionId = "66666666-6666-4666-8666-666666666666";
const skippedAssignmentId = "77777777-7777-4777-8777-777777777777";
const exerciseId = "88888888-8888-4888-8888-888888888888";

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

function makeActivityRow(overrides = {}) {
  return {
    event_key: `session:${sessionId}`,
    session_id: sessionId,
    assignment_id: null,
    activity_date: "2026-10-20",
    status: "completed",
    note: "Felt steady",
    difficulty: 6,
    energy: 4,
    workout_id: "99999999-9999-4999-8999-999999999999",
    program_id: programId,
    program_name: "Strength block",
    source_version_id: currentVersionId,
    source_version_number: 1,
    workout_name: "Full body",
    prescribed_exercise_id: exerciseId,
    prescription_name: "Goblet squat",
    sort_order: 1,
    prescribed_sets: 3,
    prescribed_reps: 10,
    prescribed_duration: null,
    prescribed_duration_unit: null,
    prescribed_distance: null,
    prescribed_distance_unit: null,
    prescribed_load: "20.000",
    prescribed_load_unit: "kg",
    prescribed_rir: null,
    prescribed_tempo: null,
    prescription_notes: "",
    session_exercise_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    actual_activity_name: "Goblet squat",
    session_set_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    actual_set_number: 1,
    actual_reps: 12,
    actual_duration: null,
    actual_duration_unit: null,
    actual_distance: null,
    actual_distance_unit: null,
    actual_load: "20.000",
    actual_load_unit: "kg",
    actual_rir: null,
    actual_intensity: null,
    actual_intensity_unit: null,
    actual_set_note: "",
    ...overrides
  };
}

async function testCoachScopedClientListAndMultiplePrograms() {
  const clientRows = {
    [coachId]: [{
      client_id: clientId,
      display_name: "Client A",
      active: true,
      programs: [
        { id: programId, name: "Strength block", status: "active", currentVersionNumber: 1, hasActivePrivateLink: true },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Mobility", status: "active", currentVersionNumber: 2, hasActivePrivateLink: false },
        { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Old plan", status: "archived", currentVersionNumber: 1, hasActivePrivateLink: false }
      ],
      last_activity_date: "2026-10-20",
      last_activity_status: "completed",
      last_activity_name: "Full body"
    }],
    "coach-b": [{
      client_id: otherClientId,
      display_name: "Client B",
      active: true,
      programs: [],
      last_activity_date: null,
      last_activity_status: null,
      last_activity_name: null
    }]
  };
  const db = createDb(({ values }) => ({
    rows: clientRows[values[0]] || [],
    rowCount: (clientRows[values[0]] || []).length
  }));

  const clients = await listCoachClients(db, coachId);
  assert.deepStrictEqual(clients.map(client => client.id), [clientId]);
  assert.deepStrictEqual(
    clients[0].activePrograms.map(program => program.id),
    [programId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    "Every active program should be returned, with no implicit primary selection."
  );
  assert.strictEqual(clients[0].activePrograms[0].hasActivePrivateLink, true);
  assert.strictEqual(clients[0].activePrograms[1].hasActivePrivateLink, false);
  assert.deepStrictEqual(clients[0].recentActivity, {
    date: "2026-10-20",
    status: "completed",
    name: "Full body"
  });

  const listQuery = db.calls[0];
  assert.strictEqual(listQuery.values[0], coachId);
  assert.match(listQuery.sql, /join public\.coach_clients cc/i);
  assert.match(listQuery.sql, /cc\.coach_profile_id\s*=\s*\$1/i);
  assert.match(listQuery.sql, /current_version\.id\s*=\s*p\.current_version_id/i);
  assert.match(listQuery.sql, /current_version\.status\s*=\s*'published'/i);
  assert.match(listQuery.sql, /when p\.status <> 'archived'[\s\S]*current_version\.status = 'published'[\s\S]*then 'active'/i);
  assert.match(listQuery.sql, /a\.status\s+in\s*\('skipped',\s*'missed'\)/i);
}

async function testOwnerRejectionAndCurrentVersionPointer() {
  const unauthorizedDb = createDb(() => ({ rows: [], rowCount: 0 }));
  const unauthorized = await getClientOverview(unauthorizedDb, "coach-b", clientId);
  assert.strictEqual(unauthorized, null, "A coach without a client relationship must get no overview.");
  assert.strictEqual(unauthorizedDb.calls.length, 1, "Ownership rejection must happen before loading program or session data.");
  assert.strictEqual(unauthorizedDb.calls[0].values[0], clientId);
  assert.strictEqual(unauthorizedDb.calls[0].values[1], "coach-b");
  assert.match(unauthorizedDb.calls[0].sql, /cc\.coach_profile_id\s*=\s*\$2/i);

  const programRows = [{
    program_id: programId,
    program_name: "Strength block",
    current_version_id: currentVersionId,
    start_date: "2026-10-01",
    current_version_number: 1,
    week_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    week_number: 1,
    week_name: "Foundation",
    workout_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    workout_name: "Full body",
    day_of_week: 1,
    is_rest: false
  }];
  const db = createDb((call, callNumber) => {
    if (callNumber === 1) {
      return {
        rows: [{ id: clientId, display_name: "Client A", active: true }],
        rowCount: 1
      };
    }
    if (callNumber === 2) return { rows: programRows, rowCount: programRows.length };
    return { rows: [], rowCount: 0 };
  });
  const overview = await getClientOverview(db, coachId, clientId);
  assert.ok(overview);
  assert.strictEqual(overview.activePrograms[0].currentVersionId, currentVersionId);
  assert.strictEqual(overview.activePrograms[0].currentVersionNumber, 1);
  assert.strictEqual(overview.activePrograms[0].weeks[0].name, "Foundation");

  const programQuery = db.calls[1].sql;
  assert.match(programQuery, /current_version\.id\s*=\s*p\.current_version_id/i);
  assert.match(programQuery, /p\.status <> 'archived'/i);
  assert.match(programQuery, /current_version\.status\s*=\s*'published'/i);
  assert.doesNotMatch(programQuery, /order\s+by\s+[^;]*version_number\s+desc/i);
}

async function testHistorySeparationAndSkippedDeduplication() {
  const completedFirstSet = makeActivityRow();
  const completedSecondSet = makeActivityRow({
    session_set_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    actual_set_number: 2,
    actual_reps: 10,
    actual_load: "22.000"
  });
  const skipped = makeActivityRow({
    event_key: `assignment:${skippedAssignmentId}`,
    session_id: null,
    assignment_id: skippedAssignmentId,
    activity_date: "2026-10-19",
    status: "skipped",
    note: "",
    difficulty: null,
    energy: null,
    workout_name: "Conditioning",
    prescribed_exercise_id: null,
    prescription_name: null,
    session_exercise_id: null,
    actual_activity_name: null,
    session_set_id: null,
    actual_set_number: null,
    actual_reps: null,
    actual_load: null
  });
  const completedWithoutFeedback = makeActivityRow({
    event_key: "session:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    session_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    activity_date: "2026-10-18",
    note: "",
    difficulty: null,
    energy: null
  });
  const missed = makeActivityRow({
    event_key: "assignment:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    session_id: null,
    assignment_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    activity_date: "2026-10-17",
    status: "missed",
    note: "",
    difficulty: null,
    energy: null,
    workout_name: "Missed workout",
    prescribed_exercise_id: null,
    prescription_name: null,
    session_exercise_id: null,
    actual_activity_name: null,
    session_set_id: null,
    actual_set_number: null,
    actual_reps: null,
    actual_load: null
  });

  const db = createDb((call, callNumber) => {
    if (callNumber === 1) {
      return {
        rows: [{ id: clientId, display_name: "Client A", active: true }],
        rowCount: 1
      };
    }
    if (callNumber === 2) return { rows: [], rowCount: 0 };
    return {
      rows: [completedFirstSet, completedSecondSet, skipped, completedWithoutFeedback, missed],
      rowCount: 5
    };
  });
  const overview = await getClientOverview(db, coachId, clientId);
  assert.strictEqual(overview.recentSessions.length, 4, "Completed, skipped, and missed activity should each appear once.");
  const completed = overview.recentSessions.find(session => session.sessionId === sessionId);
  const skippedSession = overview.recentSessions.find(session => session.assignmentId === skippedAssignmentId);
  const noFeedbackSession = overview.recentSessions.find(session => session.sessionId === completedWithoutFeedback.session_id);
  const missedSession = overview.recentSessions.find(session => session.assignmentId === missed.assignment_id);
  assert.ok(completed && skippedSession && noFeedbackSession && missedSession);
  assert.strictEqual(completed.status, "completed");
  assert.strictEqual(completed.program.versionId, currentVersionId);
  assert.strictEqual(completed.program.versionNumber, 1);
  assert.deepStrictEqual(completed.exercises[0].prescription, {
    sets: 3,
    reps: 10,
    duration: null,
    durationUnit: null,
    distance: null,
    distanceUnit: null,
    load: 20,
    loadUnit: "kg",
    rir: null,
    tempo: null,
    notes: ""
  });
  assert.deepStrictEqual(completed.exercises[0].actualSets.map(set => ({
    setNumber: set.setNumber,
    reps: set.reps,
    load: set.load
  })), [
    { setNumber: 1, reps: 12, load: 20 },
    { setNumber: 2, reps: 10, load: 22 }
  ]);
  assert.strictEqual(completed.note, "Felt steady");
  assert.strictEqual(completed.difficulty, 6);
  assert.strictEqual(completed.energy, 4);
  assert.strictEqual(skippedSession.status, "skipped");
  assert.strictEqual(skippedSession.assignmentId, skippedAssignmentId);
  assert.strictEqual(skippedSession.note, "");
  assert.strictEqual(skippedSession.difficulty, null);
  assert.strictEqual(skippedSession.energy, null);
  assert.strictEqual(noFeedbackSession.note, "");
  assert.strictEqual(noFeedbackSession.difficulty, null);
  assert.strictEqual(noFeedbackSession.energy, null);
  assert.strictEqual(missedSession.status, "missed");
  assert.strictEqual(missedSession.note, "");
  assert.strictEqual(missedSession.difficulty, null);
  assert.strictEqual(missedSession.energy, null);

  const activityQuery = db.calls[2].sql;
  assert.match(activityQuery, /union\s+all/i);
  assert.match(activityQuery, /a\.status\s+in\s*\('skipped',\s*'missed'\)/i);
  assert.match(activityQuery, /not\s+exists\s*\([\s\S]*?ws\.assignment_id\s*=\s*a\.id/i);
  assert.match(activityQuery, /source_version\.id\s*=\s*source_week\.program_version_id/i);

  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "coach-overview.js"),
    "utf8"
  );
  assert.match(dashboard, /coach-performance-label">Prescription/);
  assert.match(dashboard, /coach-performance-label">Actual result/);
  assert.match(dashboard, /missed: "Missed"/);
  assert.match(dashboard, /Private link active/);
  assert.match(dashboard, /No active private link/);
  assert.match(dashboard, /client\.active \? "Active" : "Inactive"/);
  assert.match(dashboard, /if \(session\.note\)/);
  assert.match(dashboard, /session\.difficulty != null/);
  assert.match(dashboard, /session\.energy != null/);
}

async function testClientWithoutProgramOrHistory() {
  const db = createDb((call, callNumber) => {
    if (callNumber === 1) {
      return {
        rows: [{ id: clientId, display_name: "Client A", active: true }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const overview = await getClientOverview(db, coachId, clientId);
  assert.deepStrictEqual(overview.activePrograms, []);
  assert.deepStrictEqual(overview.recentSessions, []);
  assert.ok(db.calls.every(call => /^\s*(select|with)\b/i.test(call.sql)));
}

async function testIncompleteSessionRepresentation() {
  const integrityMigration = fs.readFileSync(
    path.join(__dirname, "..", "db", "workoutplanner-migrations", "012_stage1-session-integrity.sql"),
    "utf8"
  );
  assert.match(
    integrityMigration,
    /add constraint workout_sessions_status_check[\s\S]*?check \(status in \('completed', 'skipped'\)\)/i
  );
  assert.match(
    fs.readFileSync(path.join(__dirname, "..", "workoutplanner", "coach-overview.js"), "utf8"),
    /a\.status in \('skipped', 'missed'\)/i
  );
}

async function testClientSummaryFormattingAndClipboard() {
  const summary = buildClientSummary({
    client: { displayName: "Alex Example", active: true },
    activePrograms: [
      {
        name: "Strength plan",
        currentVersionId: currentVersionId,
        currentVersionNumber: 1,
        startDate: "2026-10-01"
      },
      {
        name: "Cardio plan",
        currentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        currentVersionNumber: 2
      }
    ],
    draftProgram: { name: "Do not include this draft", versionNumber: 9 },
    recentSessions: [
      {
        performedOn: "2026-10-20",
        workoutName: "Full body",
        status: "completed",
        program: { name: "Strength plan", versionNumber: 1 },
        note: "Felt steady",
        difficulty: 6,
        energy: 4,
        exercises: [{
          name: "Goblet squat",
          prescription: { sets: 3, reps: 10, load: 20, loadUnit: "kg" },
          actualSets: [
            { setNumber: 1, reps: 12, load: 20, loadUnit: "kg" },
            { setNumber: 2, reps: 10, load: 22, loadUnit: "kg" }
          ]
        }]
      },
      {
        performedOn: "2026-10-19",
        workoutName: "Upper body",
        status: "skipped",
        program: null,
        note: "",
        difficulty: null,
        energy: null,
        exercises: []
      },
      {
        performedOn: "2026-10-18",
        workoutName: "Cardio",
        status: "missed",
        program: null,
        note: "",
        difficulty: null,
        energy: null,
        exercises: []
      }
    ]
  });

  assert.match(summary, /^Client: Alex Example/m);
  assert.match(summary, /Client status: Active/);
  assert.match(summary, /Strength plan — Version 1 \(current published\)/);
  assert.match(summary, /Cardio plan — Version 2 \(current published\)/);
  assert.doesNotMatch(summary, /Do not include this draft/);
  assert.match(summary, /2026-10-20 — Full body — Completed/);
  assert.match(summary, /2026-10-19 — Upper body — Skipped/);
  assert.match(summary, /2026-10-18 — Cardio — Missed/);
  assert.match(summary, /Prescribed: 3 × 10 reps · @ 20 kg/);
  assert.match(summary, /Actual: Set 1: 12 reps · @ 20 kg; Set 2: 10 reps · @ 22 kg/);
  assert.ok(summary.indexOf("Prescribed:") < summary.indexOf("Actual:"));
  assert.match(summary, /Feedback: Note: Felt steady · Difficulty 6\/10 · Energy 4\/5/);

  const emptySummary = buildClientSummary({
    client: { displayName: "Quiet Client" },
    activePrograms: [],
    recentSessions: []
  });
  assert.strictEqual(emptySummary, "Client: Quiet Client");

  const noFeedbackSummary = buildClientSummary({
    client: { displayName: "Quiet Client" },
    activePrograms: [],
    recentSessions: [{
      performedOn: "2026-10-18",
      workoutName: "Easy ride",
      status: "completed",
      exercises: []
    }]
  });
  assert.doesNotMatch(noFeedbackSummary, /Feedback:|No feedback|No actual|No prescription/);

  const clipboardWrites = [];
  assert.strictEqual(
    await tryCopyToClipboard(summary, {
      async writeText(text) {
        clipboardWrites.push(text);
      }
    }),
    true
  );
  assert.deepStrictEqual(clipboardWrites, [summary]);
  assert.strictEqual(
    await tryCopyToClipboard(summary, {
      async writeText() {
        throw new Error("Clipboard permission denied");
      }
    }),
    false
  );
  assert.strictEqual(await tryCopyToClipboard(summary, null), false);

  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "coach-overview.js"),
    "utf8"
  );
  assert.match(dashboard, /Copy Client Summary/);
  assert.match(dashboard, /Client summary copied to clipboard/);
  assert.match(dashboard, /Clipboard unavailable\. Select the summary text below and copy it manually/);
  assert.match(dashboard, /textArea\.select\(\)/);
  assert.match(dashboard, /overviewState\.copyingSummary/);
  const html = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "coach-overview.html"),
    "utf8"
  );
  assert.match(html, /\/dashboard\/client-summary\.js/);
}

async function testProtectedOverviewRoute() {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(
    server,
    /app\.get\(\s*['"`]\/api\/workoutplanner\/clients\/:clientId\/overview['"`],\s*requireWorkoutPlannerOwner/i
  );
  assert.match(server, /req\.workoutPlannerProfile\.id,\s*req\.params\.clientId/);
}

async function run() {
  await testCoachScopedClientListAndMultiplePrograms();
  await testOwnerRejectionAndCurrentVersionPointer();
  await testHistorySeparationAndSkippedDeduplication();
  await testClientWithoutProgramOrHistory();
  await testIncompleteSessionRepresentation();
  await testClientSummaryFormattingAndClipboard();
  await testProtectedOverviewRoute();
  console.log("WorkoutPlanner Coach Overview checks passed.");
}

run().catch(error => {
  console.error(`WorkoutPlanner Coach Overview checks failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
