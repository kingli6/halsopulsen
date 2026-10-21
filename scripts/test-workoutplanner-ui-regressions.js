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
  assert.match(planner, /complete saves become current automatically/i);
  assert.match(planner, /databaseStatus === "published"/);
  assert.match(planner, /Saved\. The live program and this private link are updated\./);
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
}

testPlannerEntryUsesCoachRoute();
testCreateAndOpenUseOwnerApi();
testAccountBasedCloneUiIsRemoved();
testPrivateLinksOpenInNewTabs();
testClientLinkPreviewIsReadOnly();
testPrivateClientCanEditTheCurrentProgram();
testPublishedProgramsUseOneSharedEditorAndDirectSessionLogging();
testProgramOverviewReplacesClientOverview();
console.log("WorkoutPlanner UI/API regression checks passed.");
