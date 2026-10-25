const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  createMockPreviewHarness,
  createClientPlannerPreviewHarness
} = require("../workoutplanner/mock-preview-harness");
const {
  injectMockPreview,
  registerWorkoutPlannerMockPreviewRoutes
} = require("../workoutplanner/mock-preview-server");

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

function testCoachAndRecipientPagesReceivePreviewData() {
  const coach = createMockPreviewHarness("coach");
  const programsResponse = coach.handleRequest({ url: "/api/workoutplanner/programs" });
  const programs = programsResponse.body.programs;
  assert.strictEqual(programs.length, 2, "the coach library should include published and draft programs");

  const published = programs.find(program => program.hasCurrentVersion);
  const draft = programs.find(program => !program.hasCurrentVersion);
  assert.ok(published && draft, "both program states should be represented");

  const editorResponse = coach.handleRequest({
    url: `/api/workoutplanner/programs/${published.id}`
  });
  assert.strictEqual(editorResponse.status, 200);
  assert.strictEqual(editorResponse.body.program.weeks.length, 2, "the editor fixture should span multiple weeks");
  assert.ok(
    editorResponse.body.program.weeks.some(week => week.days.some(day => day.exercises.length)),
    "the editor fixture should include prescribed exercises"
  );

  const overviewResponse = coach.handleRequest({
    url: `/api/workoutplanner/programs/${published.id}/overview`
  });
  assert.ok(overviewResponse.body.overview.recentSessions.length, "the overview should include workout history");
  assert.strictEqual(draft.hasCurrentVersion, false);

  const recipient = createMockPreviewHarness("recipient");
  const recipientResponse = recipient.handleRequest({ url: "/api/client/mock-recipient" });
  const data = recipientResponse.body.data;
  assert.ok(data.assignments.length, "the recipient page should include scheduled workouts");
  const today = new Date();
  const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  assert.ok(
    data.assignments.every(assignment => assignment.scheduled_date > todayString),
    "planned mock workouts should be scheduled in the future"
  );
  assert.ok(
    data.assignments.some(assignment => assignment.exercises.some(exercise => exercise.previousPerformance)),
    "the recipient schedule should show previous exercise results"
  );
  assert.ok(data.performanceHistory.length, "the recipient page should include example performance history");
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

async function testClientPlanningMockApiStaysInMemory() {
  const preview = createClientPlannerPreviewHarness();
  const base = `/api/client-planner/${preview.token}`;
  const listed = await preview.request(base);
  assert.strictEqual(listed.status, 200);
  assert.strictEqual(listed.body.programs.length, 2);

  const programId = listed.body.programs[0].id;
  const detail = await preview.request(`${base}/programs/${programId}`);
  assert.strictEqual(detail.status, 200);
  const edited = await preview.request(`${base}/programs/${programId}`, {
    method: "PUT",
    body: JSON.stringify({
      expectedRevision: detail.body.meta.revision,
      program: { ...detail.body.program, description: "A mock-only description edit." }
    })
  });
  assert.strictEqual(edited.status, 200);
  assert.strictEqual(edited.body.program.description, "A mock-only description edit.");

  const moved = await preview.request(`${base}/programs/${programId}/placement`, {
    method: "PATCH",
    body: JSON.stringify({
      expectedRevision: detail.body.placement.revision,
      plannedStartDate: "2026-11-02",
      durationWeeks: 3
    })
  });
  assert.strictEqual(moved.status, 200);
  assert.strictEqual(moved.body.placement.plannedStartDate, "2026-11-02");
  assert.strictEqual(moved.body.placement.durationWeeks, 3);

  const staleWrite = await preview.request(`${base}/programs/${programId}`, {
    method: "PUT",
    body: JSON.stringify({
      expectedRevision: detail.body.meta.revision,
      program: detail.body.program
    })
  });
  assert.strictEqual(staleWrite.status, 409);

  const created = await preview.request(`${base}/programs`, {
    method: "POST",
    body: JSON.stringify({
      program: { name: "Mock-only new program", version: 1, weeks: [] },
      placement: { plannedStartDate: "2026-11-09", durationWeeks: 1 }
    })
  });
  assert.strictEqual(created.status, 201);
  const deleted = await preview.request(`${base}/programs/${created.body.programId}`, {
    method: "DELETE"
  });
  assert.strictEqual(deleted.status, 200);
  assert.strictEqual(preview.programs.length, 2);
  assert.ok(preview.requests.every(request => request.path.startsWith(base)));
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

function testCalendarPrototypeIsServedOnlyFromTheMockPreviewRoute() {
  const registeredRoutes = new Map();
  registerWorkoutPlannerMockPreviewRoutes({
    get(route, handler) {
      registeredRoutes.set(route, handler);
    }
  });
  const handler = registeredRoutes.get("/__dev/workoutplanner/planning/");
  assert.strictEqual(typeof handler, "function", "the calendar prototype should have a dedicated preview route");

  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    sendFile(file) {
      this.file = file;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
    }
  };
  handler({}, response);
  assert.ok(response.file && fs.existsSync(response.file), "the route should serve the isolated prototype HTML");
  assert.strictEqual(response.headers["Cache-Control"], "no-store");
  assert.strictEqual(response.headers["X-Robots-Tag"], "noindex, nofollow");

  const prototypeHtml = fs.readFileSync(response.file, "utf8");
  const prototypeScriptPath = path.join(
    __dirname,
    "..",
    "dashboard",
    "workoutplanner-planning-prototype",
    "planning.js"
  );
  const prototypeScript = fs.readFileSync(prototypeScriptPath, "utf8");
  assert.match(prototypeHtml, /MOCK DATA PREVIEW/i);
  assert.match(prototypeHtml, /planning\.css/);
  assert.match(prototypeHtml, /planning\.js/);
  assert.match(prototypeScript, /createMockPreviewHarness\("coach"\)/);
  assert.match(prototypeScript, /state\.records\.filter\(record => record\.row\?\.hasCurrentVersion\)/);
  assert.doesNotMatch(prototypeScript, /\bfetch\s*\(/, "the prototype must not call APIs");
  assert.doesNotMatch(prototypeScript, /\blocalStorage\b/, "the prototype must keep edits in memory only");

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /WORKOUTPLANNER_MOCK_PREVIEWS === '1'[\s\S]*?NODE_ENV !== 'production'[\s\S]*?registerWorkoutPlannerMockPreviewRoutes/);

  const clientPlanningHandler = registeredRoutes.get("/__dev/workoutplanner/client-planning");
  assert.strictEqual(typeof clientPlanningHandler, "function", "client Planning should have an isolated mock-preview route");
  const clientPlanningResponse = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    type(contentType) {
      this.contentType = contentType;
      return this;
    },
    send(body) {
      this.body = body;
    }
  };
  clientPlanningHandler({}, clientPlanningResponse);
  assert.strictEqual(clientPlanningResponse.contentType, "html");
  assert.strictEqual(clientPlanningResponse.headers["Cache-Control"], "no-store");
  assert.strictEqual(clientPlanningResponse.headers["X-Robots-Tag"], "noindex, nofollow");
  assert.match(clientPlanningResponse.body, /client-planning\.css/);
  assert.match(clientPlanningResponse.body, /client-planner-mock-preview\.js/);
  assert.match(clientPlanningResponse.body, /dashboard\/client-planning\.js/);
  assert.doesNotMatch(clientPlanningResponse.body, /dashboard\/workoutplanner-mock-preview\.js/);

  const mockBootstrap = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "client-planner-mock-preview.js"),
    "utf8"
  );
  assert.doesNotMatch(mockBootstrap, /\bfetch\s*\(/, "the client Planning mock must not make network requests");
}

async function run() {
  await testAllApiRequestsAreIntercepted();
  testCoachAndRecipientPagesReceivePreviewData();
  await testMockProgramAndSessionInteractionsStayInMemory();
  await testClientPlanningMockApiStaysInMemory();
  testPagesUseActualHtmlWithMockBootstrap();
  testCalendarPrototypeIsServedOnlyFromTheMockPreviewRoute();
  console.log("WorkoutPlanner mock-preview isolation checks passed.");
}

run().catch(error => {
  console.error(`WorkoutPlanner mock-preview isolation checks failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
