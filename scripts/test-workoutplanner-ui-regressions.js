const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
  assert.match(planner, /Client-assigned · legacy/);
  assert.match(planner, /database-program-overflow/);
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

function testLiveEditingAndUnpublishedPublishingControls() {
  const planner = readProjectFile("dashboard/plan.js");
  const planPage = readProjectFile("dashboard/plan/index.html");
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
  assert.match(planPage, /id="databaseLegacyProgramList"/);
  assert.match(planner, /programs\.filter\(program => program\.kind === "library" && Boolean\(program\.hasCurrentVersion\)\)/);
}

function testDatabaseProgramLibraryStatesAndActions() {
  const planner = readProjectFile("dashboard/plan.js");
  const planPage = readProjectFile("dashboard/plan/index.html");
  const styles = readProjectFile("dashboard/portal.css");
  const renderStart = planner.indexOf("function renderDatabaseProgramLibrary() {");
  const renderEnd = planner.indexOf("\nasync function loadDatabaseLibrary()", renderStart);
  const renderer = planner.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(planPage, /Live programs/);
  assert.match(planPage, /Drafts — not live/);
  assert.match(planPage, /Client-assigned legacy programs/);
  assert.match(planPage, /data-program-count="live"/);
  assert.match(planPage, /data-program-count="drafts"/);
  assert.match(planPage, /data-program-count="legacy"/);
  assert.match(renderer, /Published · live/);
  assert.match(renderer, /Draft · not live/);
  assert.match(renderer, /Client-assigned · legacy/);
  assert.match(renderer, /Private link · Active/);
  assert.match(renderer, /Private link · No link/);
  assert.match(renderer, /data-open-database-program/);
  assert.match(renderer, /data-toggle-program-history/);
  assert.match(renderer, /data-copy-program-link/);
  assert.match(renderer, /data-rotate-program-link/);
  assert.match(renderer, /data-revoke-program-link/);
  assert.match(renderer, /data-copy-client-link/);
  assert.match(renderer, /data-rotate-client-link/);
  assert.match(renderer, /data-revoke-client-link/);
  assert.doesNotMatch(renderer, /data-duplicate-program|data-delete-database-program/);
  assert.doesNotMatch(planPage, /id="databaseProgramLibraryHeading"|SAVED PROGRAMS/);
  assert.match(styles, /\.database-program-item[\s\S]*?\.database-program-overflow-menu/);
}

function testDatabaseProgramLibraryRendersFixtureStates() {
  const planner = readProjectFile("dashboard/plan.js");
  const renderStart = planner.indexOf("function renderDatabaseProgramLibrary() {");
  const renderEnd = planner.indexOf("\nasync function loadDatabaseLibrary()", renderStart);
  const renderer = planner.slice(renderStart, renderEnd);
  const counts = {
    live: { textContent: "" },
    drafts: { textContent: "" },
    legacy: { textContent: "" }
  };
  const elements = {
    databaseProgramLibrary: { hidden: true },
    databasePublishedProgramList: { innerHTML: "" },
    databaseSavedProgramList: { innerHTML: "" },
    databaseLegacyProgramList: { innerHTML: "" },
    databaseProgramLibrarySummary: {
      querySelector(selector) {
        const key = selector.match(/data-program-count="([^"]+)"/)?.[1];
        return counts[key] || null;
      }
    },
    publishedDatabaseProgramCount: { textContent: "" },
    savedDatabaseProgramCount: { textContent: "" },
    legacyDatabaseProgramCount: { textContent: "" }
  };
  const program = ({
    id,
    name,
    kind = "library",
    clientId = null,
    hasCurrentVersion = false,
    currentVersion = null,
    version = 1,
    versionStatus = "draft",
    hasActivePrivateLink = false,
    hasPublishedVersion = false
  }) => ({
    id,
    name,
    kind,
    clientId,
    hasCurrentVersion,
    currentVersion,
    version,
    versionStatus,
    hasActivePrivateLink,
    hasPublishedVersion,
    durationWeeks: 4,
    updatedAt: "2026-10-23T12:00:00.000Z",
    startDate: "2026-10-26",
    publishedStartDate: "2026-10-26",
    personName: kind === "client" ? "Alex" : "",
    description: ""
  });
  const context = {
    document: { getElementById: id => elements[id] || null },
    databaseWorkspace: true,
    adminDatabaseWorkspace: true,
    planState: {
      databasePrograms: [
        program({
          id: "live",
          name: "Current strength plan",
          hasCurrentVersion: true,
          currentVersion: 3,
          version: 3,
          versionStatus: "published",
          hasActivePrivateLink: true
        }),
        program({
          id: "pending-draft",
          name: "Strength plan with saved draft",
          hasCurrentVersion: true,
          currentVersion: 3,
          version: 4,
          versionStatus: "draft",
          hasActivePrivateLink: true
        }),
        program({ id: "draft", name: "New draft" }),
        program({
          id: "legacy",
          name: "Existing client program",
          kind: "client",
          clientId: "client-id",
          hasCurrentVersion: true,
          currentVersion: 1,
          version: 1,
          versionStatus: "published",
          hasActivePrivateLink: true,
          hasPublishedVersion: true
        })
      ]
    },
    renderLibrarySummary() {},
    escapePlanHtml: value => String(value ?? ""),
    formatPublishedDate: () => "Oct 23, 2026"
  };

  vm.runInNewContext(`${renderer}\nrenderDatabaseProgramLibrary();`, context);

  assert.strictEqual(elements.databaseProgramLibrary.hidden, false);
  assert.deepStrictEqual(
    [counts.live.textContent, counts.drafts.textContent, counts.legacy.textContent],
    ["2", "1", "1"]
  );
  assert.match(elements.databasePublishedProgramList.innerHTML, /Published · live/);
  assert.match(elements.databasePublishedProgramList.innerHTML, /Live v3/);
  assert.match(elements.databasePublishedProgramList.innerHTML, /Draft v4 · not live/);
  assert.match(elements.databasePublishedProgramList.innerHTML, /data-copy-program-link="live"/);
  assert.match(elements.databasePublishedProgramList.innerHTML, /data-rotate-program-link="live"/);
  assert.match(elements.databasePublishedProgramList.innerHTML, /data-revoke-program-link="live"/);
  assert.match(elements.databaseSavedProgramList.innerHTML, /Draft · not live/);
  assert.match(elements.databaseSavedProgramList.innerHTML, /Private link · No link/);
  assert.doesNotMatch(elements.databaseSavedProgramList.innerHTML, /data-create-program-link/);
  assert.match(elements.databaseLegacyProgramList.innerHTML, /Client-assigned · legacy/);
  assert.match(elements.databaseLegacyProgramList.innerHTML, /Preview as client/);
  assert.match(elements.databaseLegacyProgramList.innerHTML, /data-copy-client-link="client-id"/);
}

function testDatabaseProgramHandlersUseContainingLibraryRoot() {
  const planner = readProjectFile("dashboard/plan.js");
  const planPage = readProjectFile("dashboard/plan/index.html");
  const libraryStart = planPage.indexOf('id="databaseProgramLibrary"');
  const libraryEnd = planPage.indexOf('<p class="library-access-note"', libraryStart);
  const libraryMarkup = planPage.slice(libraryStart, libraryEnd);
  const bindStart = planner.indexOf("function bindPlanEvents() {");
  const bindEnd = planner.indexOf("\n}\n\nif (!sharedProgramWorkspace)", bindStart);
  const bindings = planner.slice(bindStart, bindEnd);

  assert.ok(libraryStart >= 0 && libraryEnd > libraryStart);
  assert.match(libraryMarkup, /id="databasePublishedProgramList"/);
  assert.match(libraryMarkup, /id="databaseSavedProgramList"/);
  assert.match(
    bindings,
    /if \(databaseWorkspace\) \{\s*document\.getElementById\("databaseProgramLibrary"\)\.addEventListener\("click"/
  );
  assert.match(
    bindings,
    /const databaseProgramLibrary = document\.getElementById\("databaseProgramLibrary"\);\s*if \(databaseProgramLibrary\) \{\s*databaseProgramLibrary\.addEventListener\("click"/
  );
  assert.doesNotMatch(bindings, /getElementById\("databaseProgramList"\)/);
  assert.match(bindings, /openDatabaseProgram\(open\.dataset\.openDatabaseProgram\)/);
  assert.match(bindings, /toggleProgramVersionHistory\(history\.dataset\.toggleProgramHistory, history\)/);
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

testPlannerEntryUsesCoachRoute();
testCreateAndOpenUseOwnerApi();
testAccountBasedCloneUiIsRemoved();
testPrivateLinksOpenInNewTabs();
testClientLinkPreviewIsReadOnly();
testPrivateClientCanEditTheCurrentProgram();
testPublishedProgramsUseOneSharedEditorAndDirectSessionLogging();
testProgramOverviewReplacesClientOverview();
testLiveEditingAndUnpublishedPublishingControls();
testDatabaseProgramLibraryStatesAndActions();
testDatabaseProgramLibraryRendersFixtureStates();
testDatabaseProgramHandlersUseContainingLibraryRoot();
testPrivateProgramPagesAreNoindexAndPrintable();
testProgressIndicationsUseComparableCompletedSessions();
console.log("WorkoutPlanner UI/API regression checks passed.");
