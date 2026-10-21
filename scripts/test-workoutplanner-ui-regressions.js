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
  assert.match(planner, /data-create-client-copy/);
  assert.match(planner, /data-client-copy-select/);
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
  assert.match(clientLinkRoute, /res\.redirect\(302, clientPath\)/);
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
  assert.match(
    planner,
    /program\.kind === "client"[\s\S]*?Preview as client[\s\S]*?open=1&amp;preview=1/
  );
  assert.match(clientUi, /preview: new URLSearchParams\(window\.location\.search\)\.get\("preview"\) === "1"/);
  assert.match(clientUi, /!clientPage\.preview && item\.id/);
  assert.match(clientUi, /if \(clientPage\.preview\)[\s\S]*?Preview mode is read-only\./);
  assert.match(clientUi, /OWNER PREVIEW · READ ONLY/);
  assert.match(sessionRoute, /req\.query\.preview === '1'[\s\S]*?status\(403\)/);
  assert.match(clientPage, /id="previewBanner" hidden role="status"/);
}

testPlannerEntryUsesCoachRoute();
testCreateAndOpenUseOwnerApi();
testAccountBasedCloneUiIsRemoved();
testPrivateLinksOpenInNewTabs();
testClientLinkPreviewIsReadOnly();
console.log("WorkoutPlanner UI/API regression checks passed.");
