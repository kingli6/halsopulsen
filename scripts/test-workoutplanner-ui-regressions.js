const assert = require("assert");
const fs = require("fs");
const path = require("path");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function testPlannerEntryUsesCoachRoute() {
  const server = readProjectFile("server.js");
  const account = readProjectFile("account.html");
  assert.match(
    server,
    /app\.get\(\['\/plans', '\/plans\/'\], \(req, res\) => res\.redirect\('\/admin\/plans'\)\);/
  );
  assert.doesNotMatch(account, /href=["']\/plans\/?["']/);
}

function testCreateAndOpenUseOwnerApi() {
  const server = readProjectFile("server.js");
  const planner = readProjectFile("dashboard/plan.js");
  assert.match(
    server,
    /app\.post\('\/api\/workoutplanner\/programs', requireWorkoutPlannerOwner/
  );
  assert.match(
    server,
    /app\.get\('\/api\/workoutplanner\/programs\/:programId', requireWorkoutPlannerOwner/
  );
  assert.match(planner, /fetch\(endpoint, \{\s*method: planState\.databaseProgramId \? "PUT" : "POST"/);
  assert.match(
    planner,
    /async function openDatabaseProgram\(programId\)[\s\S]*?fetch\(`\/api\/workoutplanner\/programs\/\$\{encodeURIComponent\(programId\)\}`/
  );
}

function testAccountBasedCloneUiIsRemoved() {
  const planner = readProjectFile("dashboard/plan.js");
  assert.doesNotMatch(
    planner,
    /ensureLegacyCloneForm|legacyCloneProgramForm|data-clone-database-program|beginLegacyClone/
  );
  assert.doesNotMatch(planner, /data-create-client-copy|data-client-copy-select/);
  assert.match(planner, /Legacy linked program/);
  assert.match(planner, /Existing private link controls/);
}

function testPrivateLinksOpenInNewTabs() {
  const server = readProjectFile("server.js");
  const planner = readProjectFile("dashboard/plan.js");
  const clientLinkRoute = server.slice(
    server.indexOf("app.get('/api/workoutplanner/clients/:clientId/programs/:programId/link'"),
    server.indexOf("app.post('/api/workoutplanner/clients/:clientId/programs/:programId/link'")
  );
  const programLinkRoute = server.slice(
    server.indexOf("app.get('/api/workoutplanner/programs/:programId/link'"),
    server.indexOf("app.post('/api/workoutplanner/programs/:programId/link'")
  );

  assert.match(clientLinkRoute, /req\.query\.open === '1'/);
  assert.match(clientLinkRoute, /res\.redirect\(302, previewPath\)/);
  assert.match(clientLinkRoute, /req\.query\.preview === '1'[\s\S]*?\?preview=1/);
  assert.match(programLinkRoute, /req\.query\.open === '1'/);
  assert.match(programLinkRoute, /res\.redirect\(302, programPath\)/);
  assert.match(
    planner,
    /href="\/api\/workoutplanner\/programs\/\$\{programId\}\/link\?open=1"[\s\S]*?target="_blank" rel="noopener"/
  );
  assert.match(
    planner,
    /href="\/api\/workoutplanner\/clients\/\$\{encodeURIComponent\(program\.clientId\)\}\/programs\/\$\{programId\}\/link\?open=1"[\s\S]*?target="_blank" rel="noopener"/
  );
}

function testClientLinkPreviewIsReadOnly() {
  const server = readProjectFile("server.js");
  const planner = readProjectFile("dashboard/plan.js");
  const clientUi = readProjectFile("dashboard/client.js");
  const clientPage = readProjectFile("dashboard/client.html");
  const clientLinkRoute = server.slice(
    server.indexOf("app.get('/api/workoutplanner/clients/:clientId/programs/:programId/link'"),
    server.indexOf("app.post('/api/workoutplanner/clients/:clientId/programs/:programId/link'")
  );
  const sessionRoute = server.slice(
    server.indexOf("app.post('/api/client/:token/sessions'"),
    server.indexOf("app.get('/api/admin/session'")
  );

  assert.match(clientLinkRoute, /req\.query\.preview === '1'[\s\S]*?\?preview=1/);
  assert.match(planner, /else if \(adminDatabaseWorkspace && program\.kind === "client" && program\.clientId\)/);
  assert.match(planner, /Preview as client/);
  assert.match(planner, /open=1&amp;preview=1/);
  assert.match(clientUi, /preview: new URLSearchParams\(window\.location\.search\)\.get\("preview"\) === "1"/);
  assert.match(clientUi, /!clientPage\.preview && item\.id/);
  assert.match(clientUi, /if \(clientPage\.preview\)[\s\S]*?Preview mode is read-only\./);
  assert.match(clientUi, /OWNER PREVIEW · READ ONLY/);
  assert.match(sessionRoute, /req\.query\.preview === '1'[\s\S]*?status\(403\)/);
  assert.match(clientPage, /id="previewBanner" hidden role="status"/);
}

function testPrivateClientCanEditTheCurrentProgram() {
  const server = readProjectFile("server.js");
  const clientUi = readProjectFile("dashboard/client.js");
  const clientPage = readProjectFile("dashboard/client.html");
  const getProgramRoute = server.slice(
    server.indexOf("app.get('/api/client/:token/program'"),
    server.indexOf("app.put('/api/client/:token/program'")
  );
  const saveProgramRoute = server.slice(
    server.indexOf("app.put('/api/client/:token/program'"),
    server.indexOf("app.post('/api/client/:token/sessions'")
  );

  assert.match(getProgramRoute, /getClientProgramEditContext/);
  assert.match(getProgramRoute, /loadCurrentProgram/);
  assert.match(getProgramRoute, /loaded\.versionId !== loaded\.currentVersionId/);
  assert.doesNotMatch(getProgramRoute, /loaded\.kind !== 'client'/);
  assert.match(saveProgramRoute, /req\.query\.preview === '1'[\s\S]*?status\(403\)/);
  assert.match(saveProgramRoute, /clientLinkSave: !context\.directProgram/);
  assert.match(saveProgramRoute, /directLinkSave: context\.directProgram/);
  assert.match(saveProgramRoute, /clientAccessTokenHash: tokenHash/);
  assert.match(clientUi, /shared-program-workspace/);
  assert.match(clientUi, /workoutplanner:program-saved/);
  assert.match(clientUi, /workoutId: assignment\.workout_id/);
  assert.match(clientUi, /programVersionId: assignment\.program_version_id/);
  assert.match(clientPage, /id="programSaveBanner"/);
}

function testPublishedProgramsUseOneSharedEditorAndDirectSessionLogging() {
  const server = readProjectFile("server.js");
  const planner = readProjectFile("dashboard/plan.js");
  const clientUi = readProjectFile("dashboard/client.js");
  const sessionLogger = readProjectFile("workoutplanner/session-logging.js");
  const planPage = readProjectFile("dashboard/plan/index.html");

  assert.match(server, /req\.query\.preview === '1' \? 'client\.html' : path\.join\('plan', 'index\.html'\)/);
  assert.match(planner, /sharedProgramWorkspace/);
  assert.match(planner, /complete schedules become current automatically/i);
  assert.match(planner, /databaseStatus === "published"/);
  assert.match(planner, /Live update saved\. The current program and this private link are updated\./);
  assert.match(planPage, /id="sharedSessionSection"/);
  assert.match(clientUi, /const canLog = !clientPage\.preview && item\.id/);
  assert.match(sessionLogger, /directProgram/);
  assert.match(sessionLogger, /programVersionId/);
  assert.match(sessionLogger, /insert into public\.workout_sessions[\s\S]*?program_id/);
}

function testProgramOverviewReplacesClientOverview() {
  const overviewPage = readProjectFile("dashboard/coach-overview.html");
  const overviewUi = readProjectFile("dashboard/program-overview.js");
  const server = readProjectFile("server.js");

  assert.match(overviewPage, /<h1>Program overview<\/h1>/);
  assert.match(overviewPage, /\/dashboard\/program-overview\.js/);
  assert.doesNotMatch(overviewPage, /id="clientList"|id="clientDetail"/);
  assert.match(server, /\/api\/workoutplanner\/programs\/:programId\/overview/);
  assert.match(overviewUi, /Copy private link/);
  assert.match(overviewUi, /Recorded workouts/);
  assert.match(overviewPage, /id="programSearch"/);
  assert.match(overviewPage, /value="legacy">Client-assigned · legacy/);
  assert.match(overviewUi, /Published · live/);
  assert.match(overviewUi, /Saved update v\$\{latestVersion\} · not published/);
  assert.match(overviewUi, /opens the current published version/);
  assert.match(overviewUi, /share the current published version/);
  assert.match(overviewUi, /programSearch"\)\.addEventListener\("input", renderProgramList\)/);
  assert.doesNotMatch(overviewUi, /program-overview-heading[\s\S]*?Open program library/);
  assert.doesNotMatch(overviewPage, /OWNER WORKSPACE|Plan with intent\. Keep every version\./);
  assert.match(overviewPage, /class="topnav-link" href="\/admin\/plans\/">Program library/);
}

function testLiveEditingAndUnpublishedPublishingControls() {
  const planner = readProjectFile("dashboard/plan.js");
  const planPage = readProjectFile("dashboard/plan/index.html");
  const bindingStart = planner.indexOf("function bindPlanEvents()");
  const bindingImplementation = planner.slice(
    bindingStart,
    planner.indexOf("\napplyAdminWorkspaceCopy();", bindingStart)
  );
  const saveImplementation = planner.slice(
    planner.indexOf("async function saveDatabaseProgram"),
    planner.indexOf("async function publishDatabaseProgram")
  );
  const publishImplementation = planner.slice(
    planner.indexOf("async function publishDatabaseProgram"),
    planner.indexOf("async function publishPlan")
  );

  assert.match(saveImplementation, /const makeCurrentWhenValid = adminDatabaseWorkspace[\s\S]*?Boolean\(planState\.databaseProgramCurrentVersionId\)/);
  assert.match(publishImplementation, /planState\.databaseProgramKind === "library"[\s\S]*?planState\.databaseProgramCurrentVersionId/);
  assert.match(publishImplementation, /\/api\/workoutplanner\/programs\/\$\{encodeURIComponent\(planState\.databaseProgramId\)\}\/publish/);
  assert.match(planPage, /id="databasePublishedProgramList"/);
  assert.match(planPage, /id="databaseSavedProgramList"/);
  assert.match(planner, /programs\.filter\(program => Boolean\(program\.hasCurrentVersion\)\)/);
  assert.match(bindingImplementation, /databasePublishedProgramList/);
  assert.match(bindingImplementation, /databaseSavedProgramList/);
  assert.doesNotMatch(bindingImplementation, /getElementById\("databaseProgramList"\)/);
  assert.match(bindingImplementation, /getElementById\("createPlanBtn"\)\.addEventListener/);
}

function testMobileWorkoutLoggingAndCoachActions() {
  const clientUi = readProjectFile("dashboard/client.js");
  const clientCss = readProjectFile("dashboard/client.css");
  const clientPage = readProjectFile("dashboard/client.html");
  const planUi = readProjectFile("dashboard/plan.js");
  const planPage = readProjectFile("dashboard/plan/index.html");
  const portalCss = readProjectFile("dashboard/portal.css");
  const assignmentRenderer = clientUi.slice(
    clientUi.indexOf("function renderAssignment"),
    clientUi.indexOf("function renderAssignments")
  );
  const sessionSave = clientUi.slice(
    clientUi.indexOf("async function saveSessionForm"),
    clientUi.indexOf("async function saveProgramEditForm")
  );

  assert.ok(
    assignmentRenderer.indexOf("data-open-log") < assignmentRenderer.indexOf('class="client-exercises"'),
    "the first Log performance action should precede the exercise list"
  );
  assert.ok(
    assignmentRenderer.indexOf('class="session-log-actions"') < assignmentRenderer.indexOf("renderPerformanceExercise"),
    "the save controls should be available before the exercise entry fields"
  );
  assert.match(assignmentRenderer, /aria-controls="session-log-\$\{escapeHtml\(item\.id\)\}"/);
  assert.match(clientUi, /open\.hidden = true/);
  assert.match(clientUi, /openButton\.hidden = false/);
  assert.ok(
    sessionSave.indexOf("if (!response.ok || !result.ok)") < sessionSave.indexOf("confirmation.hidden = false"),
    "success feedback must only appear after a successful response"
  );
  assert.match(sessionSave, /if \(form\.dataset\.saving === "true"\) return/);
  assert.match(sessionSave, /status\.classList\.add\("is-error"\)/);
  assert.match(clientPage, /id="workoutSaveBanner" hidden role="status"/);
  assert.match(clientCss, /\.session-log-actions\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(clientCss, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(clientCss, /@media \(max-width: 700px\)[\s\S]*?\.session-log-actions\s*\{[\s\S]*?position:\s*sticky/);

  assert.ok(
    planPage.indexOf('class="publish-panel card"') < planPage.indexOf('id="weekBuilderHeading"'),
    "coach save and publish actions should be near the start of the editor"
  );
  assert.match(planPage, /id="saveDatabaseProgramBtn"[^>]*>Save draft/);
  assert.match(planPage, /id="publishBtn"[^>]*>Publish program/);
  assert.match(planUi, /saveButton\.textContent = "Save live update"/);
  assert.match(planUi, /immediateLibrarySave\s*\?\s*"Save live update"[\s\S]*?adminDatabaseWorkspace[\s\S]*?"Save draft"/);
  assert.match(planUi, /Draft saved\. It remains unpublished until you publish it\./);
  assert.match(planUi, /publishButton\.disabled = planState\.databaseSaving/);
  assert.match(planUi, /planState\.publishing \|\| planState\.databaseSaving/);
  assert.match(portalCss, /@media \(max-width: 620px\)[\s\S]*?\.publish-panel\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(portalCss, /#workoutModal \.modal-actions[\s\S]*?display:\s*grid/);
}

function testPrivateProgramPagesAreNoindexAndPrintable() {
  const planPage = readProjectFile("dashboard/plan/index.html");
  const clientPage = readProjectFile("dashboard/client.html");
  const planner = readProjectFile("dashboard/plan.js");
  const printCss = readProjectFile("dashboard/plan-print.css");

  assert.match(planPage, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(clientPage, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(planPage, /id="printProgramBtn"[^>]*>Print program/);
  assert.match(planPage, /id="printProgramContent"/);
  assert.match(planner, /function renderPrintableProgram\(\)[\s\S]*?program\.weeks/);
  assert.match(planner, /printProgramBtn[\s\S]*?window\.print\(\)/);
  assert.match(printCss, /@media print/);
  assert.match(printCss, /break-inside: avoid/);
}

function testProgressIndicationsUseComparableCompletedSessions() {
  const programOverview = readProjectFile("dashboard/program-overview.js");
  const clientUi = readProjectFile("dashboard/client.js");
  const helper = readProjectFile("dashboard/progress-insights.js");
  const overviewPage = readProjectFile("dashboard/coach-overview.html");
  const planPage = readProjectFile("dashboard/plan/index.html");

  assert.match(programOverview, /loadProgramActivitySummary/);
  assert.match(programOverview, /Last activity/);
  assert.match(programOverview, /WorkoutProgress\?\.findStrengthLoadImprovements/);
  assert.match(clientUi, /WorkoutProgress\?\.findStrengthLoadImprovements/);
  assert.match(helper, /session\?\.status && session\.status !== "completed"/);
  assert.match(helper, /setCount\}.*repsKey.*unit/);
  assert.match(overviewPage, /progress-insights\.js/);
  assert.match(planPage, /progress-insights\.js/);
}

function testWorkoutAvailabilityAndPublishedSafeClientViews() {
  const planner = readProjectFile("dashboard/plan.js");
  const planPage = readProjectFile("dashboard/plan/index.html");
  const trackerData = readProjectFile("dashboard/data.js");
  const programLibrary = readProjectFile("workoutplanner/program-library.js");
  const clientAccess = readProjectFile("workoutplanner/client-access.js");
  const clientWorkouts = readProjectFile("dashboard/client-workouts.js");
  const availabilityMigration = readProjectFile("db/workoutplanner-migrations/016_workout-availability.sql");
  const userPlanSummary = planner.slice(
    planner.indexOf("function userPlanSummary"),
    planner.indexOf("function setPlanText")
  );

  assert.match(planPage, /id="workoutAvailabilityInput"[\s\S]*?value="program">Program[\s\S]*?value="independent">Independent[\s\S]*?value="both">Both/);
  assert.match(planner, /availability: document\.getElementById\("workoutAvailabilityInput"\)\.value/);
  assert.match(planner, /day\.enabled && day\.exercises\.length && TrackerData\.workoutCanBeIndependent\(day\)/);
  assert.match(planner, /type !== "workout" \|\| TrackerData\.workoutCanBeScheduled\(template\.data\)/);
  assert.match(trackerData, /workoutCanBeScheduled\(workout\)/);
  assert.match(clientWorkouts, /\.filter\(template => template\.availability === "program" \|\| template\.availability === "both"\)/);
  assert.match(clientWorkouts, /template\.availability === "independent" \|\| template\.availability === "both"/);
  assert.match(programLibrary, /name: currentOnly \? "Published program"/);
  assert.match(programLibrary, /and w\.availability in \('program', 'both'\)/i);
  assert.match(clientAccess, /w\.availability IN \('program', 'both'\)/);
  assert.doesNotMatch(userPlanSummary, /draftProgram/);
  assert.match(planner, /const program = planState\.data\.publishedProgram;/);
  assert.match(availabilityMigration, /CHECK \(availability IN \('program', 'independent', 'both'\)\)/i);
  assert.match("016_workout-availability.sql", /^\d+_[a-z0-9-]+\.sql$/i);
}

testPlannerEntryUsesCoachRoute();
testCreateAndOpenUseOwnerApi();
testAccountBasedCloneUiIsRemoved();
testPrivateLinksOpenInNewTabs();
testClientLinkPreviewIsReadOnly();
testPrivateClientCanEditTheCurrentProgram();
testPublishedProgramsUseOneSharedEditorAndDirectSessionLogging();
testProgramOverviewReplacesClientOverview();
testLiveEditingAndUnpublishedPublishingControls();
testMobileWorkoutLoggingAndCoachActions();
testPrivateProgramPagesAreNoindexAndPrintable();
testProgressIndicationsUseComparableCompletedSessions();
testWorkoutAvailabilityAndPublishedSafeClientViews();
console.log("WorkoutPlanner UI/API regression checks passed.");
