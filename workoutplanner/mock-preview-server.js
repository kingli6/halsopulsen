const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const UNIFIED_PREVIEW_FILE = path.join(ROOT, "dashboard", "workoutplanner-unified-mock", "unified.html");
const PLANNING_PROTOTYPE_FILE = path.join(
  ROOT,
  "dashboard",
  "workoutplanner-planning-prototype",
  "planning.html"
);
const PREVIEW_PAGES = {
  coach: {
    route: "/coach",
    file: path.join(ROOT, "dashboard", "plan", "index.html"),
    marker: '<script src="/dashboard/data.js"></script>'
  },
  overview: {
    route: "/overview",
    file: path.join(ROOT, "dashboard", "coach-overview.html"),
    marker: '<script src="/dashboard/progress-insights.js" defer></script>'
  },
  recipient: {
    route: "/recipient",
    file: path.join(ROOT, "dashboard", "client.html"),
    marker: '<script src="/dashboard/progress-insights.js"></script>'
  },
  "client-planning": {
    route: "/client-planning",
    file: path.join(ROOT, "dashboard", "client-planning.html"),
    marker: '<script src="/dashboard/client-planning.js" defer></script>'
  }
};

function injectMockPreview(html, page) {
  const pageConfig = page === "client-planning"
    ? `<script src="/workoutplanner/mock-preview-harness.js"></script>
       <script src="/dashboard/client-planner-mock-preview.js"></script>`
    : `<script>window.WORKOUTPLANNER_MOCK_PREVIEW_PAGE=${JSON.stringify(page)};</script>
       <script src="/workoutplanner/mock-preview-harness.js"></script>
       <script src="/dashboard/workoutplanner-mock-preview.js"></script>`;
  const marker = PREVIEW_PAGES[page].marker;
  if (!html.includes(marker)) {
    throw new Error(`Could not find the ${page} page script insertion point.`);
  }
  return html.replace(marker, `${pageConfig}\n    ${marker}`);
}

function sendMockPreviewPage(res, page) {
  try {
    const html = fs.readFileSync(PREVIEW_PAGES[page].file, "utf8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(injectMockPreview(html, page));
  } catch (error) {
    console.error(`Could not render WorkoutPlanner ${page} mock preview:`, error.message);
    res.status(500).send("The local WorkoutPlanner mock preview could not be loaded.");
  }
}

function sendUnifiedMockPreview(res) {
  try {
    const html = fs.readFileSync(UNIFIED_PREVIEW_FILE, "utf8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(html);
  } catch (error) {
    console.error("Could not render the unified WorkoutPlanner mock preview:", error.message);
    res.status(500).send("The local WorkoutPlanner mock preview could not be loaded.");
  }
}

function registerWorkoutPlannerMockPreviewRoutes(app) {
  app.get("/__dev/workoutplanner/", (req, res) => sendUnifiedMockPreview(res));
  app.get("/__dev/workoutplanner/library/", (req, res) => sendUnifiedMockPreview(res));
  app.get("/__dev/workoutplanner/client-schedule/", (req, res) => sendUnifiedMockPreview(res));
  for (const [page, config] of Object.entries(PREVIEW_PAGES)) {
    app.get(`/__dev/workoutplanner${config.route}`, (req, res) => sendMockPreviewPage(res, page));
  }
  app.get("/__dev/workoutplanner/planning/", (req, res) => {
    if (!fs.existsSync(PLANNING_PROTOTYPE_FILE)) {
      res.status(500).send("The WorkoutPlanner calendar prototype could not be loaded.");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(PLANNING_PROTOTYPE_FILE);
  });
}

module.exports = {
  injectMockPreview,
  sendUnifiedMockPreview,
  registerWorkoutPlannerMockPreviewRoutes
};
