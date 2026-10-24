const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  createMockPreviewHarness
} = require("../workoutplanner/mock-preview-harness");
const { injectMockPreview } = require("../workoutplanner/mock-preview-server");

function makeResponse(body, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

async function testAllApiRequestsAreIntercepted() {
  const nativeRequests = [];
  const nativeFetch = async (input, init = {}) => {
    nativeRequests.push({ input, init });
    return makeResponse({ native: true }, 200);
  };

  for (const page of ["coach", "overview", "recipient"]) {
    const preview = createMockPreviewHarness(page);
    const fetch = preview.createFetch(nativeFetch, makeResponse, "https://preview.test");
    const apiResponse = await fetch("/api/workoutplanner/programs");
    assert.strictEqual((await apiResponse.json()).ok, true, `${page} API should use mock data`);
    assert.strictEqual(nativeRequests.length, 0, `${page} API must not reach native fetch`);
    assert.strictEqual(preview.requests.length, 1);

    const unknownApiResponse = await fetch("/api/unrecognized-write", { method: "POST", body: "{}" });
    assert.strictEqual(unknownApiResponse.status, 404);
    assert.strictEqual((await unknownApiResponse.json()).ok, false);
    assert.strictEqual(nativeRequests.length, 0, "unknown API requests must be blocked, not forwarded");
  }

  await nativeFetch("/dashboard/client.css");
  assert.strictEqual(nativeRequests.length, 1, "non-API static assets may use the normal server");
}

async function testMockProgramAndSessionInteractionsStayInMemory() {
  const nativeRequests = [];
  const preview = createMockPreviewHarness("coach");
  const fetch = preview.createFetch(async (...args) => {
    nativeRequests.push(args);
    return makeResponse({}, 500);
  }, makeResponse, "https://preview.test");

  const createResponse = await fetch("/api/workoutplanner/programs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personName: "Taylor",
      program: {
        name: "Mock-created plan",
        version: 1,
        startDate: "2026-10-26",
        weeks: [{
          weekNumber: 1,
          days: [{ weekday: 1, enabled: true, exercises: [{ name: "Squat" }] }]
        }]
      }
    })
  });
  const created = await createResponse.json();
  assert.strictEqual(createResponse.status, 201);
  assert.match(created.meta.id, /^mock-program-new-/);
  assert.strictEqual(preview.state.programs[0].row.name, "Mock-created plan");

  const publishResponse = await fetch(`/api/workoutplanner/programs/${created.meta.id}/publish`, {
    method: "POST"
  });
  const published = await publishResponse.json();
  assert.strictEqual(published.meta.versionStatus, "published");
  assert.strictEqual(preview.state.programs[0].row.hasCurrentVersion, true);

  const recipientResponse = await fetch("/api/client/mock-recipient");
  const recipient = await recipientResponse.json();
  const assignment = recipient.data.assignments[0];
  const sessionResponse = await fetch("/api/client/mock-recipient/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assignmentId: assignment.id,
      performedOn: assignment.scheduled_date,
      note: "Mock-only session",
      exercises: [{
        workoutExerciseId: assignment.exercises[0].id,
        sets: [{ reps: "8", load: "22", loadUnit: "kg" }]
      }]
    })
  });
  const savedSession = await sessionResponse.json();
  assert.strictEqual(sessionResponse.status, 201);
  assert.strictEqual(savedSession.session.note, "Mock-only session");
  assert.strictEqual(preview.state.recipient.data.performanceHistory[0].sets[0].load, 22);
  assert.deepStrictEqual(nativeRequests, [], "mock edits and session saves must remain in memory");
}

function testPagesUseActualHtmlWithMockBootstrap() {
  const previewServer = fs.readFileSync(
    path.join(__dirname, "..", "workoutplanner", "mock-preview-server.js"),
    "utf8"
  );
  assert.match(previewServer, /dashboard.*plan.*index\.html/);
  assert.match(previewServer, /dashboard.*coach-overview\.html/);
  assert.match(previewServer, /dashboard.*client\.html/);

  const coachHtml = injectMockPreview(
    '<head><script src="/dashboard/data.js"></script></head>',
    "coach"
  );
  assert.match(coachHtml, /WORKOUTPLANNER_MOCK_PREVIEW_PAGE="coach"/);
  assert.match(coachHtml, /workoutplanner-mock-preview\.js/);

  const clientUi = fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.js"), "utf8");
  const planUi = fs.readFileSync(path.join(__dirname, "..", "dashboard", "plan.js"), "utf8");
  assert.match(clientUi, /mockRecipientPreview/);
  assert.match(planUi, /mockPreviewWorkspace/);
  assert.match(planUi, /!sharedProgramWorkspace && !mockPreviewWorkspace/);
  assert.match(planUi, /if \(!sharedProgramWorkspace && !mockPreviewWorkspace\) \{\s*TrackerData\.ensureAssignments[\s\S]*?TrackerData\.save/);
}

async function run() {
  await testAllApiRequestsAreIntercepted();
  await testMockProgramAndSessionInteractionsStayInMemory();
  testPagesUseActualHtmlWithMockBootstrap();
  console.log("WorkoutPlanner mock-preview isolation checks passed.");
}

run().catch(error => {
  console.error(`WorkoutPlanner mock-preview isolation checks failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
