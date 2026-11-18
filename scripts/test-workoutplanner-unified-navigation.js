const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const workoutData = require("../dashboard/workoutplanner-unified-mock/workout-data");
const planningPrototypeState = require("../dashboard/workoutplanner-planning-prototype/planning-state");
const mockPreviewHarness = require("../workoutplanner/mock-preview-harness");

function createPreview(screen, view) {
  const app = {
    innerHTML: "",
    classList: { remove() {}, add() {} },
    querySelectorAll() { return []; }
  };
  const mainNav = { innerHTML: "" };
  const documentListeners = {};
  const windowListeners = {};
  const roleButtons = ["coach", "client"].map(role => ({
    dataset: { role },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  const elements = {
    "app-main": app,
    "main-nav": mainNav,
    "modal-backdrop": { hidden: true, addEventListener() {} },
    modal: { innerHTML: "", addEventListener() {}, querySelector() { return { focus() {} }; } }
  };
  const location = {
    pathname: "/__dev/workoutplanner/",
    search: `?screen=${screen}${view ? `&view=${view}` : ""}`,
    origin: "http://workoutplanner.mock"
  };
  const document = {
    getElementById(id) {
      return elements[id] || (elements[id] = { innerHTML: "" });
    },
    querySelectorAll(selector) {
      return selector === "[data-role]" ? roleButtons : [];
    },
    addEventListener(type, handler) { documentListeners[type] = handler; }
  };
  const window = {
    WorkoutPlannerUnifiedMockData: workoutData,
    location,
    addEventListener(type, handler) { windowListeners[type] = handler; },
    scrollTo() {}
  };
  const source = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "workoutplanner-unified-mock", "unified.js"),
    "utf8"
  );
  vm.runInNewContext(source, {
    window,
    location,
    document,
    history: {
      pushState(_state, _title, url) {
        const next = new URL(url, location.origin);
        location.pathname = next.pathname;
        location.search = next.search;
      }
    },
    URLSearchParams,
    Date,
    setTimeout,
    clearTimeout
  });
  return { app, documentListeners, location, mainNav, roleButtons, windowListeners };
}

function click(preview, selector, dataset) {
  const event = {
    target: {
      closest(candidate) {
        return candidate === selector ? { dataset } : null;
      }
    },
    preventDefault() {}
  };
  preview.documentListeners.click(event);
}

function createPlanningPrototypePreview(audience = "coach") {
  const makeElement = () => ({
    innerHTML: "",
    hidden: false,
    addEventListener() {},
    replaceChildren() {},
    querySelector() { return null; }
  });
  const elements = {
    "app-main": makeElement(),
    "dialog-backdrop": makeElement(),
    dialog: makeElement(),
    "toast-region": makeElement()
  };
  const previewNav = {
    removed: false,
    remove() { this.removed = true; }
  };
  const workspaceLabel = { textContent: "Coach workspace" };
  const navItems = ["calendar-home", "preview-nav"].map(action => ({
    dataset: { action },
    setAttribute(name, value) { this[name] = value; }
  }));
  const documentListeners = {};
  const document = {
    getElementById(id) { return elements[id] || (elements[id] = makeElement()); },
    querySelector(selector) {
      if (selector === ".brand-copy small") return workspaceLabel;
      if (selector === '.topnav [data-action="preview-nav"]') return previewNav;
      if (selector === ".topbar") return makeElement();
      return null;
    },
    querySelectorAll(selector) { return selector === ".nav-item" ? navItems : []; },
    addEventListener(type, handler) { documentListeners[type] = handler; }
  };
  const window = {
    WorkoutPlannerMockHarness: mockPreviewHarness,
    WorkoutPlannerPlanningState: planningPrototypeState,
    location: { search: audience === "client" ? "?audience=client" : "" },
    setTimeout() {}
  };
  const source = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "workoutplanner-planning-prototype", "planning.js"),
    "utf8"
  );
  vm.runInNewContext(source, { window, document, URLSearchParams, Date });
  return { app: elements["app-main"], navItems, previewNav, workspaceLabel, documentListeners };
}

function testRoleNavigationAndPlanningViews() {
  const preview = createPreview("coach-overview");
  assert.match(preview.mainNav.innerHTML, />Overview</);
  assert.match(preview.mainNav.innerHTML, />Planning</);
  assert.match(preview.mainNav.innerHTML, />Library</);
  assert.match(preview.mainNav.innerHTML, />Goals &amp; Progress</);
  assert.strictEqual(preview.roleButtons[0].attributes["aria-pressed"], "true");

  click(preview, "[data-go]", { go: "coach-planning" });
  assert.match(preview.location.search, /screen=coach-planning&view=timeline/);
  assert.match(preview.app.innerHTML, /data-planning-view="timeline" aria-pressed="true"/);
  assert.match(preview.app.innerHTML, /data-embed-kind="timeline"/);
  assert.match(preview.app.innerHTML, /\/__dev\/workoutplanner\/planning\//);

  click(preview, "[data-planning-view]", { planningView: "week" });
  assert.match(preview.location.search, /screen=coach-planning&view=week/);
  assert.match(preview.app.innerHTML, /data-embed-kind="client-week"/);
  assert.match(preview.app.innerHTML, /workspace=planning/);

  click(preview, "[data-role]", { role: "client" });
  assert.match(preview.location.search, /screen=client-overview/);
  assert.strictEqual(preview.roleButtons[0].attributes["aria-pressed"], "false");
  assert.strictEqual(preview.roleButtons[1].attributes["aria-pressed"], "true");

  click(preview, "[data-go]", { go: "client-planning" });
  assert.match(preview.location.search, /screen=client-planning&view=week/);
  click(preview, "[data-planning-view]", { planningView: "timeline" });
  assert.match(preview.location.search, /screen=client-planning&view=timeline/);
  assert.match(preview.app.innerHTML, /Week and Timeline use separate sample views/);
  assert.doesNotMatch(preview.app.innerHTML, /Coach Timeline mock in both roles/);
}

function testClientOverviewUsesOnePlanningDestinationForBothViews() {
  const preview = createPreview("client-overview");
  const overview = preview.app.innerHTML;
  assert.match(overview, /Coming up/);
  assert.match(overview, /Recent activity/);
  assert.match(overview, /<strong>Open Week<\/strong>/);
  assert.match(overview, /<strong>Open Timeline<\/strong>/);
  assert.doesNotMatch(overview, /<strong>Your workouts<\/strong>/);
  assert.doesNotMatch(overview, /See your week/);
  assert.match(overview, /href="\/__dev\/workoutplanner\/\?screen=client-planning&amp;view=week"/);
  assert.match(overview, /href="\/__dev\/workoutplanner\/\?screen=client-planning&amp;view=timeline"/);

  click(preview, "[data-go]", { go: "client-planning", view: "week" });
  assert.match(preview.location.search, /screen=client-planning&view=week/);
  assert.match(preview.app.innerHTML, /data-embed-kind="client-week"/);
  click(preview, "[data-planning-view]", { planningView: "timeline" });
  assert.match(preview.location.search, /screen=client-planning&view=timeline/);
  assert.match(preview.app.innerHTML, /data-embed-kind="client-timeline"/);
  assert.match(preview.app.innerHTML, /planning\/\?audience=client/);
  assert.match(preview.app.innerHTML, /<h1>Planning<\/h1>/);
  assert.match(preview.app.innerHTML, /data-planning-view="week"/);
}

function testClientTimelineUsesTheCoachCalendarWithoutCoachControls() {
  const coach = createPlanningPrototypePreview("coach");
  assert.match(coach.app.innerHTML, /data-action="add-program"/);
  assert.match(coach.app.innerHTML, /<button class="program-bar/);

  const client = createPlanningPrototypePreview("client");
  assert.strictEqual(client.workspaceLabel.textContent, "Client workspace");
  assert.strictEqual(client.previewNav.removed, true);
  assert.match(client.app.innerHTML, /Client planning timeline/);
  assert.match(client.app.innerHTML, /published sample program/);
  assert.match(client.app.innerHTML, /Strength &amp; Mobility Foundations/);
  assert.doesNotMatch(client.app.innerHTML, /Return-to-Running/);
  assert.doesNotMatch(client.app.innerHTML, /data-action="(?:add-program|open-program|edit-schedule|preview-program)"/);
  assert.doesNotMatch(client.app.innerHTML, /<button class="program-bar/);
  assert.match(client.app.innerHTML, /<div class="program-bar is-static/);
  assert.match(client.app.innerHTML, /<div class="mobile-program is-static"/);
  assert.match(client.app.innerHTML, /This timeline is read-only/);
}

function testLibrariesProgramsAndGoalsAreReachable() {
  const preview = createPreview("client-overview");
  click(preview, "[data-go]", { go: "client-library" });
  assert.match(preview.location.search, /screen=client-library/);
  assert.match(preview.app.innerHTML, /workspace=workouts/);
  assert.match(preview.app.innerHTML, /data-embed-kind="client-workouts"/);

  click(preview, "[data-go]", { go: "client-programs" });
  assert.match(preview.app.innerHTML, /Your program/);
  assert.match(preview.app.innerHTML, /data-go="client-planning"/);
  assert.match(preview.app.innerHTML, /Back to overview/);

  click(preview, "[data-go]", { go: "client-goals" });
  assert.match(preview.app.innerHTML, /Goals &amp; Progress/);
  assert.match(preview.app.innerHTML, /No goal editing or Goal Map is implemented/);
  assert.match(preview.app.innerHTML, /data-go="client-overview"/);

  click(preview, "[data-role]", { role: "coach" });
  click(preview, "[data-go]", { go: "coach-library" });
  assert.match(preview.location.search, /screen=library/);
  assert.match(preview.app.innerHTML, /data-go="coach-programs"/);

  click(preview, "[data-go]", { go: "coach-programs" });
  assert.match(preview.app.innerHTML, /data-embed-kind="program-library"/);
  assert.match(preview.app.innerHTML, /\/__dev\/workoutplanner\/coach\//);
  assert.match(preview.app.innerHTML, /data-go="coach-library"/);
}

function testLegacyShowroomScreensStillResolve() {
  const coachLibrary = createPreview("library");
  assert.match(coachLibrary.app.innerHTML, /Workout library/);

  const clientWorkouts = createPreview("workouts");
  assert.match(clientWorkouts.app.innerHTML, /workspace=workouts/);
  assert.match(clientWorkouts.mainNav.innerHTML, />Library</);
}

function testPlanningControlsStayResponsiveAndCoachProgramNavigationIsAvailable() {
  const coachOverview = createPreview("coach-overview");
  assert.match(coachOverview.app.innerHTML, /data-go="coach-programs">Saved programs/);
  const coach = createPreview("coach-planning", "week");
  assert.match(coach.app.innerHTML, /data-go="coach-programs">Saved programs<\/a>/);
  const styles = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "workoutplanner-unified-mock", "unified.css"),
    "utf8"
  );
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.planning-page-actions \{ width: 100%; \}/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.planning-view-switch button \{ flex: 1 1 50%; \}/);
}

testRoleNavigationAndPlanningViews();
testClientOverviewUsesOnePlanningDestinationForBothViews();
testClientTimelineUsesTheCoachCalendarWithoutCoachControls();
testLibrariesProgramsAndGoalsAreReachable();
testLegacyShowroomScreensStillResolve();
testPlanningControlsStayResponsiveAndCoachProgramNavigationIsAvailable();
console.log("Unified WorkoutPlanner navigation checks passed.");
