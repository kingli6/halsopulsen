const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  createMockPreviewHarness,
  createClientPlannerPreviewHarness
} = require("../workoutplanner/mock-preview-harness");
const {
  injectMockPreview,
  registerWorkoutPlannerMockPreviewRoutes
} = require("../workoutplanner/mock-preview-server");
const clientWorkoutWorkspace = require("../dashboard/client-workouts");
const clientPlanningMockTools = require("../dashboard/client-planning-mock-tools");
const planningPrototypeState = require("../dashboard/workoutplanner-planning-prototype/planning-state");

function testWorkoutAvailabilityNormalizationAndClientViews() {
  const source = fs.readFileSync(path.join(__dirname, "..", "dashboard", "data.js"), "utf8");
  const sandbox = { localStorage: { getItem() { return null; }, setItem() {} } };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nglobalThis.__trackerData = TrackerData;`, sandbox);
  const trackerData = sandbox.__trackerData;
  const exercise = { name: "Test squat", activityType: "strength", sets: 3, targetValue: 10, targetUnit: "reps" };
  const program = trackerData.normalizeProgram({
    name: "Availability test",
    startDate: "2026-10-26",
    weeks: [{
      weekNumber: 1,
      days: [
        { weekday: 1, enabled: true, name: "Program only", availability: "program", exercises: [exercise] },
        { weekday: 2, enabled: true, name: "Independent only", availability: "independent", exercises: [exercise] },
        { weekday: 3, enabled: true, name: "Both", availability: "both", exercises: [exercise] }
      ]
    }]
  });
  assert.strictEqual(program.weeks[0].days[2].availability, "independent");
  assert.strictEqual(trackerData.workoutCanBeScheduled(program.weeks[0].days[2]), false);
  assert.strictEqual(trackerData.workoutCanBeIndependent(program.weeks[0].days[2]), true);
  assert.strictEqual(trackerData.workoutCanBeScheduled(program.weeks[0].days[3]), true);
  assert.strictEqual(trackerData.workoutCanBeIndependent(program.weeks[0].days[3]), true);
  assert.strictEqual(trackerData.workoutAvailability({}), "program", "legacy workouts default to Program");

  const assignmentState = { publishedProgram: program, assignments: [], assignmentPrefix: "test" };
  trackerData.ensureAssignments(assignmentState);
  assert.deepStrictEqual(
    assignmentState.assignments.map(assignment => assignment.date),
    ["2026-10-26", "2026-10-28"],
    "Independent-only workouts must not receive scheduled assignments, while Both remains scheduled."
  );

  const planned = clientWorkoutWorkspace.getWorkouts("2026-10-26");
  const optional = clientWorkoutWorkspace.getIndependentWorkouts(clientWorkoutWorkspace.createState());
  assert.ok(planned.some(workout => workout.id === "recovery-mobility"));
  assert.ok(optional.some(workout => workout.id === "recovery-mobility"), "Both workouts appear in both client lists.");
  assert.ok(optional.some(workout => workout.id === "mobility-reset"));
  assert.ok(!planned.some(workout => workout.id === "mobility-reset"), "Independent-only workouts are not scheduled.");
}

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
      program: {
        name: "Mock-only four-week program",
        version: 1,
        weeks: Array.from({ length: 4 }, (_, index) => ({
          weekNumber: index + 1,
          name: `Week ${index + 1}`,
          phase: "Foundation",
          days: []
        }))
      },
      placement: { plannedStartDate: "2026-11-09", durationWeeks: 4 }
    })
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.program.weeks.length, 4);
  assert.strictEqual(created.body.placement.durationWeeks, 4);

  const sixWeeks = await preview.request(`${base}/programs/${created.body.programId}`, {
    method: "PUT",
    body: JSON.stringify({
      expectedRevision: created.body.meta.revision,
      program: {
        ...created.body.program,
        weeks: Array.from({ length: 6 }, (_, index) => ({
          weekNumber: index + 1,
          name: `Week ${index + 1}`,
          phase: "Foundation",
          days: []
        }))
      }
    })
  });
  assert.strictEqual(sixWeeks.status, 200);
  assert.strictEqual(sixWeeks.body.program.weeks.length, 6);
  assert.strictEqual(sixWeeks.body.placement.durationWeeks, 6);
  assert.strictEqual(sixWeeks.body.placement.revision, 0, "The period remains linked while it matches the program.");

  const fiveWeeks = await preview.request(`${base}/programs/${created.body.programId}`, {
    method: "PUT",
    body: JSON.stringify({
      expectedRevision: sixWeeks.body.meta.revision,
      program: {
        ...sixWeeks.body.program,
        weeks: Array.from({ length: 5 }, (_, index) => ({
          weekNumber: index + 1,
          name: `Week ${index + 1}`,
          phase: "Foundation",
          days: []
        }))
      }
    })
  });
  assert.strictEqual(fiveWeeks.body.placement.durationWeeks, 5, "Removing a week updates a linked period.");

  const customPeriod = await preview.request(`${base}/programs/${created.body.programId}/placement`, {
    method: "PATCH",
    body: JSON.stringify({
      expectedRevision: fiveWeeks.body.placement.revision,
      plannedStartDate: "2026-11-16",
      durationWeeks: 4
    })
  });
  assert.strictEqual(customPeriod.status, 200);
  assert.strictEqual(customPeriod.body.placement.revision, 1);

  const changedCustomProgram = await preview.request(`${base}/programs/${created.body.programId}`, {
    method: "PUT",
    body: JSON.stringify({
      expectedRevision: fiveWeeks.body.meta.revision,
      program: {
        ...fiveWeeks.body.program,
        weeks: Array.from({ length: 6 }, (_, index) => ({
          weekNumber: index + 1,
          name: `Week ${index + 1}`,
          phase: "Foundation",
          days: []
        }))
      }
    })
  });
  assert.strictEqual(changedCustomProgram.body.program.weeks.length, 6);
  assert.strictEqual(changedCustomProgram.body.placement.durationWeeks, 4, "An explicitly customized period stays fixed.");
  assert.strictEqual(changedCustomProgram.body.placement.revision, 1);

  const deleted = await preview.request(`${base}/programs/${created.body.programId}`, {
    method: "DELETE"
  });
  assert.strictEqual(deleted.status, 200);
  assert.strictEqual(preview.programs.length, 2);
  assert.ok(preview.requests.every(request => request.path.startsWith(base)));
}

function testClientPlanningWeekEditorIsCompactAndResponsive() {
  const clientPlanningUi = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "client-planning.js"),
    "utf8"
  );
  const clientPlanningCss = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "client-planning.css"),
    "utf8"
  );
  assert.match(clientPlanningUi, /data-week-selector/);
  assert.match(clientPlanningUi, /data-action="previous-week"/);
  assert.match(clientPlanningUi, /data-action="next-week"/);
  assert.match(clientPlanningUi, /data-action="duplicate-week"/);
  assert.match(clientPlanningUi, /Week \$\{state\.weekIndex \+ 1\} of \$\{weekCount\}/);
  assert.match(clientPlanningUi, /selectedWeek \? cycleCard\(selectedWeek, state\.weekIndex\)/);
  assert.doesNotMatch(clientPlanningUi, /state\.program\.weeks\.map\(cycleCard\)/);
  assert.match(clientPlanningCss, /@media \(max-width: 460px\)[\s\S]*?planner-week-selector select/);
}

function testClientWorkoutsWorkspaceInteractionsStayInMemory() {
  const state = clientWorkoutWorkspace.createState(new Date("2026-10-25T12:00:00Z"));
  const initialWeek = state.weekStart;
  assert.strictEqual(initialWeek, "2026-10-19");

  const overview = clientWorkoutWorkspace.render(state);
  assert.match(overview, /Workouts/);
  assert.match(overview, /Full-body strength A/);
  assert.match(overview, /Easy cardio \+ mobility/);
  assert.match(overview, /Recovery mobility/);
  assert.match(overview, /Completed/);
  assert.match(overview, /No workout planned/);
  assert.doesNotMatch(overview, /Goblet squat/, "the week overview should not expand every exercise.");

  clientWorkoutWorkspace.handleAction(state, "next-week");
  assert.strictEqual(state.weekStart, "2026-10-26");
  clientWorkoutWorkspace.handleAction(state, "previous-week");
  assert.strictEqual(state.weekStart, initialWeek);

  clientWorkoutWorkspace.handleAction(state, "open-workout", "strength-b");
  const details = clientWorkoutWorkspace.render(state);
  assert.match(details, /Back to Workouts/);
  assert.match(details, /Reverse lunge/);
  assert.match(details, /3 × 8 reps/);
  assert.match(details, /75 sec rest/);
  assert.match(details, /Record workout/);

  clientWorkoutWorkspace.handleAction(state, "record-workout");
  const sessionForm = clientWorkoutWorkspace.render(state);
  assert.match(sessionForm, /data-workout-result="reps"/);
  assert.match(sessionForm, /data-workout-result="weight"/);
  assert.match(sessionForm, /data-workout-complete-set/);
  assert.match(sessionForm, /Session notes/);
  assert.match(sessionForm, /prescribed workout stays as written/i);

  const workout = clientWorkoutWorkspace.getWorkouts(state.weekStart)
    .find(item => item.id === "strength-b");
  const prescribedWeight = workout.exercises[0].weight;
  clientWorkoutWorkspace.setResult(state, workout, "reverse-lunge", 0, "reps", "9");
  clientWorkoutWorkspace.setResult(state, workout, "reverse-lunge", 0, "weight", "8");
  clientWorkoutWorkspace.setCompleted(state, workout, "reverse-lunge", 0, true);
  clientWorkoutWorkspace.setNotes(state, workout, "Felt steady; added one rep.");
  const updatedSession = clientWorkoutWorkspace.render(state);
  assert.match(updatedSession, /value="9"/);
  assert.match(updatedSession, /value="8"/);
  assert.match(updatedSession, /Felt steady; added one rep\./);

  clientWorkoutWorkspace.handleAction(state, "finish-session");
  assert.match(clientWorkoutWorkspace.render(state), /Session recorded/);
  assert.strictEqual(clientWorkoutWorkspace.statusFor(state, workout), "planned", "a session performed on a different date must not complete the scheduled workout.");
  assert.strictEqual(workout.exercises[0].weight, prescribedWeight, "recording results must not rewrite the prescription.");

  clientWorkoutWorkspace.handleAction(state, "back-to-week");
  assert.match(clientWorkoutWorkspace.render(state), /Strength B/);
  assert.strictEqual(clientWorkoutWorkspace.statusFor(state, workout), "planned");

  const workspaceSource = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "client-workouts.js"),
    "utf8"
  );
  const planningUi = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "client-planning.js"),
    "utf8"
  );
  const planningHtml = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "client-planning.html"),
    "utf8"
  );
  const planningCss = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "client-planning.css"),
    "utf8"
  );
  assert.doesNotMatch(workspaceSource, /\bfetch\s*\(|\blocalStorage\b/, "workout mock interactions must stay in memory.");
  assert.match(planningUi, /if \(!previewHarness \|\| !workspaceNav\) return/);
  assert.match(planningHtml, /client-workouts\.js/);
  assert.match(planningCss, /@media \(max-width: 460px\)[\s\S]*?client-workout-set-row/);
}

function testPlanningMockMovesSessionsOneDayWithoutOverwriting() {
  const week = {
    days: Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      enabled: false,
      name: "",
      description: "",
      sessionType: "Rest / open day",
      warmup: "",
      cooldown: "",
      exercises: []
    }))
  };
  const workout = name => ({
    enabled: true,
    name,
    sessionType: "Strength",
    description: "",
    warmup: "",
    cooldown: "",
    exercises: [{ name: `${name} exercise` }]
  });
  clientPlanningMockTools.addSession(week, 3, workout("Wednesday session"));
  clientPlanningMockTools.addSession(week, 5, workout("Friday session"));

  const toThursday = clientPlanningMockTools.moveSession(week, 3, 1, 0);
  assert.strictEqual(toThursday.moved, true);
  assert.strictEqual(toThursday.targetWeekday, 4);
  assert.strictEqual(clientPlanningMockTools.listSessions(clientPlanningMockTools.findDay(week, 3)).length, 0);
  assert.deepStrictEqual(
    clientPlanningMockTools.listSessions(clientPlanningMockTools.findDay(week, 4)).map(item => item.name),
    ["Wednesday session"],
    "the move should stop on Thursday rather than skip to the next planned day."
  );

  const toFriday = clientPlanningMockTools.moveSession(week, 4, 1, 0);
  assert.strictEqual(toFriday.moved, true);
  assert.strictEqual(toFriday.targetWeekday, 5);
  assert.deepStrictEqual(
    clientPlanningMockTools.listSessions(clientPlanningMockTools.findDay(week, 5)).map(item => item.name),
    ["Friday session", "Wednesday session"],
    "moving onto an occupied day should preserve both sessions without swapping or overwriting."
  );
  clientPlanningMockTools.addSession(week, 5, workout("Third Friday session"));
  assert.strictEqual(clientPlanningMockTools.listSessions(clientPlanningMockTools.findDay(week, 5)).length, 3);
  clientPlanningMockTools.removeSession(week, 5, 0);
  assert.deepStrictEqual(
    clientPlanningMockTools.listSessions(clientPlanningMockTools.findDay(week, 5)).map(item => item.name),
    ["Wednesday session", "Third Friday session"],
    "removing a day's first session should promote, not discard, the remaining sessions."
  );
  assert.strictEqual(clientPlanningMockTools.moveSession(week, 7, 1, 0).moved, false);
}

function testIndependentWorkoutsAndPersonalCreationStayInMemory() {
  const state = clientWorkoutWorkspace.createState(new Date("2026-10-25T12:00:00Z"));
  const initialOverview = clientWorkoutWorkspace.render(state);
  assert.match(initialOverview, /class="client-workout-day[^"]*is-today/);
  assert.match(initialOverview, /class="client-workout-today-pill">Today/);
  assert.match(initialOverview, /No planned workout today/);
  assert.match(initialOverview, /<details class="client-independent-library/);
  assert.match(initialOverview, /Record now/);
  assert.match(initialOverview, /Add to today/);

  clientWorkoutWorkspace.handleAction(state, "add-to-today", "quick-strength", "coach");
  const addedOverview = clientWorkoutWorkspace.render(state);
  assert.match(addedOverview, /Quick strength/);
  assert.match(addedOverview, /Extra · Planned/);
  assert.strictEqual(state.addedWorkouts[0].date, state.today);
  assert.strictEqual(state.recordedSessions.length, 0, "adding an independent workout must not mark it complete.");
  assert.match(addedOverview, /<details class="client-independent-library"[^>]*open/);

  const instantState = clientWorkoutWorkspace.createState(new Date("2026-10-25T12:00:00Z"));
  clientWorkoutWorkspace.handleAction(instantState, "record-now", "mobility-reset", "coach");
  assert.match(clientWorkoutWorkspace.render(instantState), /RECORDING SESSION · Sunday 25 October/);
  clientWorkoutWorkspace.handleAction(instantState, "finish-session");
  assert.strictEqual(instantState.recordedSessions[0].performedOn, "2026-10-25");
  clientWorkoutWorkspace.handleAction(instantState, "back-to-week");
  assert.match(clientWorkoutWorkspace.render(instantState), /Mobility reset/);
  assert.match(clientWorkoutWorkspace.render(instantState), /Extra · Completed/);

  const recordingState = clientWorkoutWorkspace.createState(new Date("2026-10-25T12:00:00Z"));
  clientWorkoutWorkspace.handleAction(recordingState, "previous-week");
  assert.strictEqual(recordingState.weekStart, "2026-10-12");
  clientWorkoutWorkspace.handleAction(recordingState, "open-workout", "strength-b", "planned");
  clientWorkoutWorkspace.handleAction(recordingState, "record-workout");
  assert.match(clientWorkoutWorkspace.render(recordingState), /Sunday 25 October/);
  const selectedWorkout = clientWorkoutWorkspace.activeWorkout(recordingState);
  clientWorkoutWorkspace.setResult(recordingState, selectedWorkout, "reverse-lunge", 0, "reps", "9");
  clientWorkoutWorkspace.setCompleted(recordingState, selectedWorkout, "reverse-lunge", 0, true);
  clientWorkoutWorkspace.handleAction(recordingState, "finish-session");
  assert.strictEqual(recordingState.weekStart, "2026-10-12", "finishing a session should preserve the week the client was viewing.");
  assert.strictEqual(recordingState.recordedSessions[0].performedOn, "2026-10-25");
  assert.strictEqual(recordingState.recordedSessions[0].workout.date, "2026-10-16");
  assert.strictEqual(
    clientWorkoutWorkspace.statusFor(
      recordingState, selectedWorkout
    ),
    "planned",
    "recording a prescribed workout on another day must not complete or move the scheduled workout."
  );
  clientWorkoutWorkspace.handleAction(recordingState, "back-to-week");
  assert.strictEqual(recordingState.weekStart, "2026-10-12", "Back to Workouts should keep the previously selected week.");
  clientWorkoutWorkspace.handleAction(recordingState, "next-week");
  const actualDayOverview = clientWorkoutWorkspace.render(recordingState);
  assert.match(actualDayOverview, /Extra · Completed/);
  assert.match(actualDayOverview, /Strength B/);

  const personalState = clientWorkoutWorkspace.createState(new Date("2026-10-25T12:00:00Z"));
  clientWorkoutWorkspace.handleAction(personalState, "create-personal");
  clientWorkoutWorkspace.updateCreateDraft(personalState, "name", "My evening circuit");
  clientWorkoutWorkspace.updateCreateDraft(personalState, "description", "Easy bodyweight work at home.");
  clientWorkoutWorkspace.updateCreateDraft(personalState, "exercise.0.name", "Sit-to-stand");
  clientWorkoutWorkspace.updateCreateDraft(personalState, "exercise.0.sets", "2");
  clientWorkoutWorkspace.addCreateExercise(personalState);
  clientWorkoutWorkspace.updateCreateDraft(personalState, "exercise.1.name", "Wall push-up");
  clientWorkoutWorkspace.updateCreateDraft(personalState, "exercise.1.reps", "12");
  assert.strictEqual(clientWorkoutWorkspace.savePersonalWorkout(personalState), true);
  assert.strictEqual(personalState.personalWorkouts[0].exercises.length, 2);
  const personalOverview = clientWorkoutWorkspace.render(personalState);
  assert.match(personalOverview, /My evening circuit/);
  assert.match(personalOverview, /My workouts/);
  assert.match(personalOverview, /Personal workouts you create for yourself/);
}

function testPlanningPrototypePreservesWorkoutsWhenMovingBetweenDays() {
  const week = { days: [] };
  planningPrototypeState.normalizeWeek(week);
  assert.strictEqual(week.days.length, 7, "the Planning prototype should keep every weekday available.");

  const monday = planningPrototypeState.ensureDay(week, 1);
  const tuesday = planningPrototypeState.ensureDay(week, 2);
  planningPrototypeState.addSession(monday, {
    name: "Monday strength",
    availability: "program",
    exercises: [{ name: "Squat" }]
  });
  planningPrototypeState.addSession(tuesday, {
    name: "Tuesday mobility",
    availability: "both",
    exercises: [{ name: "Mobility flow" }]
  });

  const moved = planningPrototypeState.moveSession(week, 1, 1, 0);
  assert.deepStrictEqual(moved, { sourceWeekday: 1, targetWeekday: 2, destinationIndex: 1 });
  assert.deepStrictEqual(planningPrototypeState.listSessions(monday), [], "the moved workout should leave its original day.");
  assert.deepStrictEqual(
    planningPrototypeState.listSessions(tuesday).map(workout => workout.name),
    ["Tuesday mobility", "Monday strength"],
    "moving onto an occupied day should append the workout instead of swapping or overwriting."
  );
  assert.strictEqual(planningPrototypeState.getSession(tuesday, 0).availability, "both");
  assert.strictEqual(planningPrototypeState.getSession(tuesday, 1).availability, "program");
  assert.strictEqual(planningPrototypeState.isScheduled(planningPrototypeState.getSession(tuesday, 0)), true);
  assert.strictEqual(planningPrototypeState.isIndependent(planningPrototypeState.getSession(tuesday, 0)), true);

  const dayWithExtraOnly = planningPrototypeState.emptyDay(4);
  dayWithExtraOnly.additionalWorkouts.push({ name: "Keep this workout", availability: "independent", exercises: [] });
  planningPrototypeState.addSession(dayWithExtraOnly, { name: "New primary", exercises: [] });
  assert.deepStrictEqual(
    planningPrototypeState.listSessions(dayWithExtraOnly).map(workout => workout.name),
    ["New primary", "Keep this workout"],
    "adding the first primary workout must not discard existing sessions."
  );

  planningPrototypeState.addSession(tuesday, {
    name: "Extra recovery",
    availability: "independent",
    exercises: []
  });
  assert.strictEqual(planningPrototypeState.listSessions(tuesday).length, 3, "a day may contain multiple workouts.");
  assert.strictEqual(planningPrototypeState.isScheduled(planningPrototypeState.getSession(tuesday, 2)), false);
  assert.strictEqual(planningPrototypeState.isIndependent(planningPrototypeState.getSession(tuesday, 2)), true);

  assert.strictEqual(planningPrototypeState.removeSession(tuesday, 1), true);
  assert.deepStrictEqual(
    planningPrototypeState.listSessions(tuesday).map(workout => workout.name),
    ["Tuesday mobility", "Extra recovery"],
    "removing one workout should preserve the other sessions."
  );
  assert.strictEqual(planningPrototypeState.removeSession(tuesday, 0), true);
  assert.strictEqual(planningPrototypeState.getSession(tuesday, 0).name, "Extra recovery", "the next session should be promoted without loss.");
  assert.strictEqual(planningPrototypeState.moveSession(week, 0, -1, 0), null, "moving past the start of the week should do nothing.");
  assert.strictEqual(planningPrototypeState.normalizeAvailability("unknown"), "program");
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

  const unifiedHtml = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "workoutplanner-unified-mock", "unified.html"),
    "utf8"
  );
  const unifiedUi = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "workoutplanner-unified-mock", "unified.js"),
    "utf8"
  );
  assert.match(unifiedHtml, /data-role="coach"/);
  assert.match(unifiedHtml, /data-role="client"/);
  assert.match(unifiedHtml, /id="main-nav"/);
  for (const screen of ["coach-overview", "coach-planning", "library", "client-overview", "client-planning", "workouts"]) {
    assert.ok(unifiedUi.includes(`?screen=${screen}"`), `${screen} should have a direct shell route`);
  }
  assert.match(unifiedUi, /route === "client-planning"\) app\.innerHTML = clientPlanningPage\(\)/);
  assert.match(unifiedUi, /client-planning\/\?embed=1&workspace=workouts/);
  assert.match(unifiedUi, /availability-tag/);

  const registeredRoutes = new Map();
  registerWorkoutPlannerMockPreviewRoutes({
    get(route, handler) { registeredRoutes.set(route, handler); }
  });
  for (const route of ["/__dev/workoutplanner/", "/__dev/workoutplanner/library/", "/__dev/workoutplanner/client-schedule/"]) {
    assert.strictEqual(typeof registeredRoutes.get(route), "function", `${route} should serve the unified mock shell`);
    const response = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      type() { return this; },
      send(body) { this.body = body; }
    };
    registeredRoutes.get(route)({}, response);
    assert.match(response.body, /id="main-nav"/);
    assert.strictEqual(response.headers["X-Robots-Tag"], "noindex, nofollow");
  }
  assert.strictEqual(typeof registeredRoutes.get("/__dev/workoutplanner/planning/"), "function", "the original Planning prototype route stays available");
  assert.strictEqual(typeof registeredRoutes.get("/__dev/workoutplanner/client-planning"), "function", "the original Client Workouts/Planning mock route stays available");
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
  assert.match(prototypeHtml, /planning-state\.js/);
  assert.match(prototypeHtml, /planning\.js/);
  assert.ok(
    prototypeHtml.indexOf("planning-state.js") < prototypeHtml.indexOf("planning.js"),
    "local Planning state helpers should load before the prototype UI."
  );
  assert.match(prototypeScript, /createMockPreviewHarness\("coach"\)/);
  assert.match(prototypeScript, /state\.records\.filter\(record => record\.row\?\.hasCurrentVersion\)/);
  assert.match(prototypeScript, /Available as/);
  assert.match(prototypeScript, /client-independent-library/);
  assert.match(prototypeScript, /planningState\.moveSession/);
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
  testWorkoutAvailabilityNormalizationAndClientViews();
  await testAllApiRequestsAreIntercepted();
  testCoachAndRecipientPagesReceivePreviewData();
  await testMockProgramAndSessionInteractionsStayInMemory();
  await testClientPlanningMockApiStaysInMemory();
  testClientPlanningWeekEditorIsCompactAndResponsive();
  testClientWorkoutsWorkspaceInteractionsStayInMemory();
  testPlanningMockMovesSessionsOneDayWithoutOverwriting();
  testIndependentWorkoutsAndPersonalCreationStayInMemory();
  testPlanningPrototypePreservesWorkoutsWhenMovingBetweenDays();
  testPagesUseActualHtmlWithMockBootstrap();
  testCalendarPrototypeIsServedOnlyFromTheMockPreviewRoute();
  console.log("WorkoutPlanner mock-preview isolation checks passed.");
}

run().catch(error => {
  console.error(`WorkoutPlanner mock-preview isolation checks failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
