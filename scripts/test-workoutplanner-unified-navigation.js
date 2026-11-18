const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const workoutData = require("../dashboard/workoutplanner-unified-mock/workout-data");

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
  assert.match(preview.app.innerHTML, /role permissions are not modeled yet/);
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

testRoleNavigationAndPlanningViews();
testLibrariesProgramsAndGoalsAreReachable();
testLegacyShowroomScreensStillResolve();
console.log("Unified WorkoutPlanner navigation checks passed.");
