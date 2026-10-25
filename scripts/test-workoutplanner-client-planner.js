const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  archiveClientPlannerProgram,
  getClientPlannerContext,
  getClientPlannerProgram,
  listClientPlannerPrograms,
  setClientProgramPlacement
} = require("../workoutplanner/client-planner");
const {
  saveProgram,
  synchronizePlannerPlacementDuration
} = require("../workoutplanner/program-library");

const coachId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const otherClientId = "33333333-3333-4333-8333-333333333333";
const programId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const linkHash = "a".repeat(64);

function queryResult(rows = []) {
  return { rows, rowCount: rows.length };
}

function createClient(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      const call = { sql: String(sql), values };
      calls.push(call);
      return handler(call, calls.length) || queryResult();
    },
    release() {}
  };
}

function createPool(client) {
  return { async connect() { return client; } };
}

function normalizedSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function assertNoAssignmentOrSessionWrites(calls) {
  const writes = calls.filter(({ sql }) =>
    /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+public\.(?:assignments|workout_sessions|session_exercises|session_sets)\b/i.test(sql)
  );
  assert.deepStrictEqual(
    writes,
    [],
    "Client planning changes must not write assignments or completed-session records."
  );
}

async function testPrivateContextAndProgramIsolation() {
  const contextDb = {
    async query(sql, values) {
      assert.match(sql, /l\.token_hash = \$1/i);
      assert.match(sql, /l\.revoked_at is null/i);
      assert.match(sql, /c\.active = true/i);
      assert.match(sql, /join public\.coach_clients cc/i);
      assert.deepStrictEqual(values, [linkHash]);
      return queryResult([{
        client_id: clientId,
        coach_profile_id: coachId,
        display_name: "Planning Client"
      }]);
    }
  };
  assert.deepStrictEqual(await getClientPlannerContext(contextDb, linkHash), {
    clientId,
    coachProfileId: coachId,
    displayName: "Planning Client"
  });

  const listDb = {
    calls: [],
    async query(sql, values) {
      this.calls.push({ sql, values });
      return queryResult([{
        id: programId,
        name: "Owned program",
        description: "",
        status: "active",
        revision: 4,
        version_number: 2,
        version_status: "published",
        planned_start_date: null,
        duration_weeks: null,
        placement_revision: null
      }]);
    }
  };
  const listed = await listClientPlannerPrograms(listDb, {
    clientId,
    coachProfileId: coachId
  });
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].id, programId);
  assert.deepStrictEqual(listDb.calls[0].values, [clientId, coachId]);
  assert.match(listDb.calls[0].sql, /where p\.client_id = \$1/i);
  assert.match(listDb.calls[0].sql, /p\.coach_profile_id = \$2/i);
  assert.match(listDb.calls[0].sql, /p\.kind = 'client'/i);
  assert.match(listDb.calls[0].sql, /p\.status <> 'archived'/i);

  const deniedDb = {
    calls: [],
    async query(sql, values) {
      this.calls.push({ sql, values });
      return queryResult();
    }
  };
  assert.strictEqual(
    await getClientPlannerProgram(deniedDb, {
      clientId: otherClientId,
      coachProfileId: coachId
    }, programId),
    null
  );
  assert.strictEqual(deniedDb.calls.length, 1, "An unowned program must be rejected before its content is loaded.");
  assert.deepStrictEqual(deniedDb.calls[0].values, [programId, otherClientId, coachId]);
  assert.match(deniedDb.calls[0].sql, /p\.client_id = \$2/i);
  assert.match(deniedDb.calls[0].sql, /p\.coach_profile_id = \$3/i);
}

async function testPlacementUpsertAndStaleWriteRejection() {
  const placement = {
    plannedStartDate: "2026-10-26",
    durationWeeks: 4,
    expectedRevision: 0
  };
  const client = createClient(({ sql }) => {
    const normalized = normalizedSql(sql);
    if (normalized.toLowerCase() === "begin") return queryResult();
    if (/from public\.client_planner_access_links/i.test(normalized)) {
      return queryResult([{ id: "active-link" }]);
    }
    if (/insert into public\.client_program_placements as current_placement/i.test(normalized)) {
      return queryResult([{ revision: 1 }]);
    }
    if (normalized.toLowerCase() === "commit") return queryResult();
    if (normalized.toLowerCase() === "rollback") return queryResult();
    throw new Error(`Unexpected placement query: ${normalized}`);
  });
  const saved = await setClientProgramPlacement(
    createPool(client),
    { clientId, coachProfileId: coachId },
    linkHash,
    programId,
    placement
  );
  assert.deepStrictEqual(saved, { revision: 1 });
  const placementWrite = client.calls.find(call =>
    /insert into public\.client_program_placements as current_placement/i.test(call.sql)
  );
  assert.ok(placementWrite, "Missing placement rows must be created by the first calendar edit.");
  assert.match(placementWrite.sql, /on conflict \(program_id\) do update/i);
  assert.match(placementWrite.sql, /p\.client_id = \$4/i);
  assert.match(placementWrite.sql, /p\.coach_profile_id = \$5/i);
  assert.match(placementWrite.sql, /p\.kind = 'client'/i);
  assert.match(placementWrite.sql, /p\.status <> 'archived'/i);
  assert.match(placementWrite.sql, /current_placement\.revision = \$6/i);
  assert.deepStrictEqual(placementWrite.values, [
    placement.plannedStartDate,
    placement.durationWeeks,
    programId,
    clientId,
    coachId,
    0
  ]);
  assertNoAssignmentOrSessionWrites(client.calls);

  const existingPlacementClient = createClient(({ sql }) => {
    const normalized = normalizedSql(sql);
    if (normalized.toLowerCase() === "begin") return queryResult();
    if (/from public\.client_planner_access_links/i.test(normalized)) {
      return queryResult([{ id: "active-link" }]);
    }
    if (/insert into public\.client_program_placements as current_placement/i.test(normalized)) {
      return queryResult([{ revision: 6 }]);
    }
    if (normalized.toLowerCase() === "commit") return queryResult();
    if (normalized.toLowerCase() === "rollback") return queryResult();
    throw new Error(`Unexpected existing placement query: ${normalized}`);
  });
  const existingPlacement = await setClientProgramPlacement(
    createPool(existingPlacementClient),
    { clientId, coachProfileId: coachId },
    linkHash,
    programId,
    { ...placement, expectedRevision: 5 }
  );
  assert.deepStrictEqual(existingPlacement, { revision: 6 });
  const existingPlacementWrite = existingPlacementClient.calls.find(call =>
    /insert into public\.client_program_placements as current_placement/i.test(call.sql)
  );
  assert.strictEqual(existingPlacementWrite.values[5], 5);
  assert.match(existingPlacementWrite.sql, /expected_placement\.revision = \$6/i);
  assertNoAssignmentOrSessionWrites(existingPlacementClient.calls);

  const staleClient = createClient(({ sql }) => {
    const normalized = normalizedSql(sql);
    if (normalized.toLowerCase() === "begin") return queryResult();
    if (/from public\.client_planner_access_links/i.test(normalized)) {
      return queryResult([{ id: "active-link" }]);
    }
    if (/insert into public\.client_program_placements as current_placement/i.test(normalized)) {
      return queryResult();
    }
    if (normalized.toLowerCase() === "rollback") return queryResult();
    throw new Error(`Unexpected stale placement query: ${normalized}`);
  });
  await assert.rejects(
    setClientProgramPlacement(
      createPool(staleClient),
      { clientId, coachProfileId: coachId },
      linkHash,
      programId,
      { ...placement, expectedRevision: 8 }
    ),
    error => error.statusCode === 409 && error.code === "STALE_PLACEMENT"
  );
  assert.ok(staleClient.calls.some(call => normalizedSql(call.sql).toLowerCase() === "rollback"));
  assertNoAssignmentOrSessionWrites(staleClient.calls);

  let connected = false;
  await assert.rejects(
    setClientProgramPlacement(
      { async connect() { connected = true; return client; } },
      { clientId, coachProfileId: coachId },
      linkHash,
      programId,
      { ...placement, plannedStartDate: "2026-02-30" }
    ),
    error => error.statusCode === 400
  );
  assert.strictEqual(connected, false, "Invalid calendar values must be rejected before opening a transaction.");
}

async function testRevokedLinkAndProgramRemovalStayScoped() {
  const revokedClient = createClient(({ sql }) => {
    const normalized = normalizedSql(sql);
    if (normalized.toLowerCase() === "begin") return queryResult();
    if (/from public\.client_planner_access_links/i.test(normalized)) return queryResult();
    if (normalized.toLowerCase() === "rollback") return queryResult();
    throw new Error(`Unexpected revoked-link query: ${normalized}`);
  });
  await assert.rejects(
    setClientProgramPlacement(
      createPool(revokedClient),
      { clientId, coachProfileId: coachId },
      linkHash,
      programId,
      { plannedStartDate: "2026-10-26", durationWeeks: 4, expectedRevision: 0 }
    ),
    error => error.statusCode === 403
  );
  assert.ok(revokedClient.calls.some(call => normalizedSql(call.sql).toLowerCase() === "rollback"));

  const archiveClient = createClient(({ sql }) => {
    const normalized = normalizedSql(sql);
    if (normalized.toLowerCase() === "begin") return queryResult();
    if (/from public\.client_planner_access_links/i.test(normalized)) {
      return queryResult([{ id: "active-link" }]);
    }
    if (/update public\.programs/i.test(normalized)) return queryResult([{ id: programId }]);
    if (/update public\.client_access_links/i.test(normalized)) return queryResult();
    if (/delete from public\.client_program_placements/i.test(normalized)) return queryResult();
    if (normalized.toLowerCase() === "commit") return queryResult();
    if (normalized.toLowerCase() === "rollback") return queryResult();
    throw new Error(`Unexpected archive query: ${normalized}`);
  });
  assert.deepStrictEqual(
    await archiveClientPlannerProgram(
      createPool(archiveClient),
      { clientId, coachProfileId: coachId },
      linkHash,
      programId
    ),
    { archived: true }
  );
  const archiveWrite = archiveClient.calls.find(call => /update public\.programs/i.test(call.sql));
  assert.match(archiveWrite.sql, /client_id = \$2/i);
  assert.match(archiveWrite.sql, /coach_profile_id = \$3/i);
  assert.deepStrictEqual(archiveWrite.values, [programId, clientId, coachId]);
  assertNoAssignmentOrSessionWrites(archiveClient.calls);
}

function blankProgram(weekCount = 1) {
  return {
    name: "Client planning test",
    description: "A draft created by the private client planner.",
    startDate: null,
    weeks: Array.from({ length: weekCount }, (_, index) => ({
      weekNumber: index + 1,
      name: `Week ${index + 1}`,
      phase: "Foundation",
      days: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        enabled: false,
        name: "Rest / open day",
        sessionType: "Other",
        exercises: []
      }))
    }))
  };
}

function createSaveDb({ existing = false, revision = 0 } = {}) {
  let weekId = 0;
  let workoutId = 0;
  let loadProgramCalls = 0;
  const draftVersionId = "66666666-6666-4666-8666-666666666666";
  const client = createClient(({ sql }) => {
    const normalized = normalizedSql(sql);
    if (["begin", "commit", "rollback"].includes(normalized.toLowerCase())) {
      return queryResult();
    }
    if (/from public\.client_planner_access_links/i.test(normalized)) {
      return queryResult([{ id: "active-link" }]);
    }
    if (/select id, kind, client_id, current_version_id, revision, person_name/i.test(normalized)) {
      return existing
        ? queryResult([{
          id: programId,
          kind: "client",
          client_id: clientId,
          current_version_id: versionId,
          revision,
          person_name: ""
        }])
        : queryResult();
    }
    if (/select p\.id as program_id/i.test(normalized)) {
      loadProgramCalls += 1;
      if (existing && loadProgramCalls === 1) return queryResult();
      return queryResult([{
        program_id: programId,
        client_id: clientId,
        program_name: "Client planning test",
        program_description: "A draft created by the private client planner.",
        person_name: "",
        program_status: existing ? "active" : "draft",
        program_kind: "client",
        current_version_id: existing ? versionId : null,
        program_revision: revision + 1,
        program_updated_at: "2026-10-25T12:00:00.000Z",
        start_date: null,
        version_id: draftVersionId,
        version_number: existing ? 2 : 1,
        version_status: "draft",
        week_id: null,
        current_version_number: existing ? 1 : null
      }]);
    }
    if (/insert into public\.programs/i.test(normalized)) {
      return queryResult([{ id: programId }]);
    }
    if (/select id, version_number, status from public\.program_versions/i.test(normalized)) {
      return existing
        ? queryResult([{ id: versionId, version_number: 1, status: "published" }])
        : queryResult();
    }
    if (/insert into public\.program_versions/i.test(normalized)) {
      return queryResult([{ id: draftVersionId }]);
    }
    if (/insert into public\.program_weeks/i.test(normalized)) {
      weekId += 1;
      return queryResult([{ id: `week-${weekId}` }]);
    }
    if (/insert into public\.workouts/i.test(normalized)) {
      workoutId += 1;
      return queryResult([{ id: `workout-${workoutId}` }]);
    }
    if (/insert into public\.client_program_placements/i.test(normalized)) return queryResult();
    if (/update public\.programs\s+set name/i.test(normalized)) return queryResult();
    if (/update public\.programs\s+set revision = revision \+ 1/i.test(normalized)) return queryResult();
    throw new Error(`Unexpected program-save query: ${normalized}`);
  });
  return { client, pool: createPool(client) };
}

async function testProgramSavePathIsVersionedAndDoesNotTouchSessions() {
  const { client, pool } = createSaveDb();
  const result = await saveProgram(
    pool,
    coachId,
    blankProgram(4),
    null,
    null,
    {
      makeCurrentWhenValid: true,
      plannerLinkSave: true,
      plannerClientId: clientId,
      clientAccessTokenHash: linkHash,
      plannerPlacement: {
        plannedStartDate: "2026-10-26",
        durationWeeks: 4
      }
    }
  );
  assert.strictEqual(result.version, 1);
  assert.strictEqual(result.becameCurrent, false, "An empty program remains an editable draft.");
  assert.strictEqual(
    client.calls.filter(call => /insert into public\.workouts/i.test(call.sql)).length,
    28,
    "A four-week program retains all seven weekday slots in each week."
  );
  const programInsert = client.calls.find(call => /insert into public\.programs/i.test(call.sql));
  assert.match(programInsert.sql, /values \(\$1, \$2, 'client', ''/i);
  const savedPlacement = client.calls.find(call => /insert into public\.client_program_placements/i.test(call.sql));
  assert.ok(savedPlacement, "The new program's independent calendar placement is saved in the same transaction.");
  assert.ok(client.calls.some(call => normalizedSql(call.sql).toLowerCase() === "commit"));
  assertNoAssignmentOrSessionWrites(client.calls);
}

async function testPlannerPlacementFollowsStructureOnlyWhileItMatches() {
  const calls = [];
  const matchedClient = {
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      return queryResult([{ program_id: programId }]);
    }
  };
  const synced = await synchronizePlannerPlacementDuration(matchedClient, {
    programId,
    clientId,
    previousDurationWeeks: 4,
    nextDurationWeeks: 6
  });
  assert.deepStrictEqual(synced, { updated: true });
  assert.match(calls[0].sql, /revision = 0/i);
  assert.match(calls[0].sql, /duration_weeks = \$4/i);
  assert.deepStrictEqual(calls[0].values, [6, programId, clientId, 4]);

  const customCalls = [];
  const customClient = {
    async query(sql, values) {
      customCalls.push({ sql: String(sql), values });
      return queryResult();
    }
  };
  const custom = await synchronizePlannerPlacementDuration(customClient, {
    programId,
    clientId,
    previousDurationWeeks: 4,
    nextDurationWeeks: 6
  });
  assert.deepStrictEqual(custom, { updated: false });
  assert.match(customCalls[0].sql, /revision = 0/i);
  assert.match(customCalls[0].sql, /duration_weeks = \$4/i);

  const noChangeCalls = [];
  const noChange = await synchronizePlannerPlacementDuration({
    async query(...args) { noChangeCalls.push(args); }
  }, {
    programId,
    clientId,
    previousDurationWeeks: 4,
    nextDurationWeeks: 4
  });
  assert.deepStrictEqual(noChange, { updated: false });
  assert.strictEqual(noChangeCalls.length, 0);
}

async function testExistingProgramSaveChecksOwnerAndRevision() {
  const { client, pool } = createSaveDb({ existing: true, revision: 9 });
  const saved = await saveProgram(
    pool,
    coachId,
    blankProgram(),
    programId,
    null,
    {
      makeCurrentWhenValid: true,
      expectedRevision: 9,
      plannerLinkSave: true,
      plannerClientId: clientId,
      clientAccessTokenHash: linkHash
    }
  );
  assert.strictEqual(saved.version, 2);
  const ownerCheck = client.calls.find(call =>
    /select id, kind, client_id, current_version_id, revision, person_name/i.test(call.sql)
  );
  assert.deepStrictEqual(ownerCheck.values, [programId, coachId, clientId]);
  assert.match(ownerCheck.sql, /client_id = \$3 and kind = 'client'/i);
  assertNoAssignmentOrSessionWrites(client.calls);

  const { client: staleClient, pool: stalePool } = createSaveDb({ existing: true, revision: 9 });
  await assert.rejects(
    saveProgram(
      stalePool,
      coachId,
      blankProgram(),
      programId,
      null,
      {
        makeCurrentWhenValid: true,
        expectedRevision: 8,
        plannerLinkSave: true,
        plannerClientId: clientId,
        clientAccessTokenHash: linkHash
      }
    ),
    error => error.statusCode === 409 && error.code === "STALE_REVISION"
  );
  assert.ok(staleClient.calls.some(call => normalizedSql(call.sql).toLowerCase() === "rollback"));
  assert.ok(!staleClient.calls.some(call => /insert into public\.program_weeks/i.test(call.sql)));
  assertNoAssignmentOrSessionWrites(staleClient.calls);
}

function testRouteAndSchemaContracts() {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const plannerModule = fs.readFileSync(
    path.join(__dirname, "..", "workoutplanner", "client-planner.js"),
    "utf8"
  );
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "db", "workoutplanner-migrations", "015_client-planning-workspace.sql"),
    "utf8"
  );

  for (const route of [
    "app.get('/api/client-planner/:token'",
    "app.post('/api/client-planner/:token/programs'",
    "app.get('/api/client-planner/:token/programs/:programId'",
    "app.put('/api/client-planner/:token/programs/:programId'",
    "app.patch('/api/client-planner/:token/programs/:programId/placement'",
    "app.delete('/api/client-planner/:token/programs/:programId'",
    "app.get(['/planning/:token', '/planning/:token/']"
  ]) {
    assert.ok(server.includes(route), `Expected private Planning route: ${route}`);
  }
  assert.match(server, /app\.get\('\/api\/client-planner\/:token'[\s\S]*?getClientPlannerContext/);
  assert.match(server, /app\.put\('\/api\/client-planner\/:token\/programs\/:programId'[\s\S]*?clientAccessTokenHash:\s*tokenHash/);
  assert.match(server, /app\.get\(\['\/planning\/:token', '\/planning\/:token\/'\][\s\S]*?getClientPlannerContext/);
  assert.match(plannerModule, /where l\.token_hash = \$1[\s\S]*?l\.revoked_at is null/);
  assert.match(migration, /create table public\.client_program_placements/i);
  assert.match(migration, /foreign key \(program_id, client_id\)[\s\S]*?references public\.programs \(id, client_id\)/i);
  assert.match(migration, /alter table public\.client_program_placements enable row level security/i);
}

async function run() {
  await testPrivateContextAndProgramIsolation();
  await testPlacementUpsertAndStaleWriteRejection();
  await testRevokedLinkAndProgramRemovalStayScoped();
  await testProgramSavePathIsVersionedAndDoesNotTouchSessions();
  await testPlannerPlacementFollowsStructureOnlyWhileItMatches();
  await testExistingProgramSaveChecksOwnerAndRevision();
  testRouteAndSchemaContracts();
  console.log("WorkoutPlanner client-planner ownership, save-path, placement, and session-isolation checks passed.");
}

run().catch(error => {
  console.error(`WorkoutPlanner client-planner checks failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
