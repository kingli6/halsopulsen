const assert = require("assert");
const Module = require("module");
const fs = require("fs");
const path = require("path");
const { once } = require("events");
const {
  createWorkoutPlannerMockPreviewAccess
} = require("../workoutplanner/mock-preview-access");

function invoke(middleware, request = {}) {
  const result = {
    headers: {},
    statusCode: 200,
    nextCalled: false,
    location: "",
    body: "",
    contentType: ""
  };
  const response = {
    setHeader(name, value) {
      result.headers[name] = value;
    },
    status(code) {
      result.statusCode = code;
      return this;
    },
    type(value) {
      result.contentType = value;
      return this;
    },
    send(body) {
      result.body = body;
      return this;
    },
    sendStatus(code) {
      result.statusCode = code;
      return this;
    },
    redirect(location) {
      result.statusCode = 302;
      result.location = location;
      return this;
    }
  };
  middleware({
    originalUrl: request.originalUrl || "/__dev/workoutplanner/",
    url: request.url || request.originalUrl || "/__dev/workoutplanner/",
    authenticated: Boolean(request.authenticated)
  }, response, () => {
    result.nextCalled = true;
  });
  return result;
}

function testProductionPreviewAccessRequiresTheAdminSession() {
  const access = createWorkoutPlannerMockPreviewAccess({
    nodeEnv: "production",
    previewsEnabled: false,
    isAdmin: request => request.authenticated
  });

  const deniedPage = invoke(access.page, {
    originalUrl: "/__dev/workoutplanner/?screen=client-overview"
  });
  assert.strictEqual(deniedPage.statusCode, 302);
  assert.strictEqual(
    deniedPage.location,
    "/admin?next=%2F__dev%2Fworkoutplanner%2F%3Fscreen%3Dclient-overview"
  );

  const deniedAdminRoute = invoke(access.adminPage, {
    originalUrl: "/admin/workoutplanner-preview"
  });
  assert.strictEqual(deniedAdminRoute.statusCode, 302);
  assert.strictEqual(deniedAdminRoute.location, "/admin?next=%2Fadmin%2Fworkoutplanner-preview");

  const deniedAsset = invoke(access.asset, {
    originalUrl: "/dashboard/workoutplanner-unified-mock/unified.js"
  });
  assert.strictEqual(deniedAsset.statusCode, 401);
  assert.match(deniedAsset.body, /Admin sign-in required/);
  assert.strictEqual(deniedAsset.nextCalled, false);
  assert.strictEqual(deniedAsset.headers["Cache-Control"], "no-store");
  assert.strictEqual(deniedAsset.headers["X-Robots-Tag"], "noindex, nofollow");
  assert.strictEqual(deniedAsset.headers["Referrer-Policy"], "no-referrer");

  for (const middleware of [access.page, access.asset, access.adminPage]) {
    const allowed = invoke(middleware, { authenticated: true });
    assert.strictEqual(allowed.nextCalled, true, "an authenticated Admin session should pass the preview guard");
    assert.strictEqual(allowed.headers["Cache-Control"], "no-store");
    assert.strictEqual(allowed.headers["X-Robots-Tag"], "noindex, nofollow");
  }
}

function testDevelopmentPreviewGateRemainsUnchanged() {
  const enabled = createWorkoutPlannerMockPreviewAccess({
    nodeEnv: "development",
    previewsEnabled: true,
    isAdmin: () => false
  });
  assert.strictEqual(invoke(enabled.page).nextCalled, true);
  assert.strictEqual(invoke(enabled.asset).nextCalled, true);

  const disabled = createWorkoutPlannerMockPreviewAccess({
    nodeEnv: "development",
    previewsEnabled: false,
    isAdmin: () => false
  });
  assert.strictEqual(invoke(disabled.page).statusCode, 404);
  assert.strictEqual(invoke(disabled.asset).statusCode, 404);
}

function testAdminNavigationAndRouteWiring() {
  const root = path.join(__dirname, "..");
  for (const file of [
    "dashboard/plan/index.html",
    "dashboard/coach-overview.html",
    "dashboard/admin/booking.html"
  ]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /href="\/admin\/workoutplanner-showroom"[^>]*>WorkoutPlanner UI Preview<\/a>/);
  }

  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /isAdmin: readAdminSession/);
  assert.match(server, /app\.get\([\s\S]*?\/admin\/workoutplanner-preview[\s\S]*?workoutPlannerPreviewAccess\.adminPage[\s\S]*?sendUnifiedMockPreview/);
  assert.match(server, /app\.get\([\s\S]*?\/admin\/workoutplanner-showroom[\s\S]*?workoutPlannerPreviewAccess\.adminPage[\s\S]*?sendWorkoutPlannerShowroom/);

  for (const mount of [
    "/dashboard/workoutplanner-unified-mock",
    "/dashboard/workoutplanner-showroom",
    "/dashboard/workoutplanner-planning-prototype",
    "/dashboard/workoutplanner-mock-preview.js",
    "/dashboard/client-planner-mock-preview.js",
    "/workoutplanner/mock-preview-harness.js"
  ]) {
    assert.ok(
      server.includes(`app.use('${mount}', workoutPlannerPreviewAccess.asset)`),
      `${mount} should be protected by the Admin preview asset guard`
    );
  }
}

function loadServerAppWithoutStartingItsDefaultListener() {
  const serverPath = path.join(__dirname, "..", "server.js");
  const source = fs.readFileSync(serverPath, "utf8");
  const defaultListener = /app\.listen\(5000, '0\.0\.0\.0', \(\) => \{\s*console\.log\('HälsoPulsen running on port 5000'\);\s*\}\);/;
  assert.match(source, defaultListener, "the app startup boundary should be explicit for the access test");
  const testSource = source.replace(defaultListener, "module.exports = app;");

  const serverModule = new Module(serverPath, module);
  serverModule.filename = serverPath;
  serverModule.paths = Module._nodeModulePaths(path.dirname(serverPath));
  const originalRequire = serverModule.require.bind(serverModule);
  serverModule.require = packageName => packageName === "@clerk/express"
    ? { clerkMiddleware: () => (_req, _res, next) => next(), getAuth: () => ({}) }
    : originalRequire(packageName);
  serverModule._compile(testSource, serverPath);
  return serverModule.exports;
}

async function testHttpRoutesUseTheExistingAdminSession() {
  const environment = {
    NODE_ENV: "production",
    WORKOUTPLANNER_MOCK_PREVIEWS: "0",
    ADMIN_PASSWORD: "test-only-admin-password",
    SESSION_SECRET: "test-only-session-signing-secret"
  };
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;
  process.env.CLERK_SECRET_KEY = "";
  process.env.CLERK_PUBLISHABLE_KEY = "";

  const app = loadServerAppWithoutStartingItsDefaultListener();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (pathname, cookie) => fetch(new URL(pathname, baseUrl), {
    redirect: "manual",
    headers: cookie ? { Cookie: cookie } : {}
  });

  try {
    for (const route of [
      "/admin/workoutplanner-preview",
      "/admin/workoutplanner-showroom",
      "/__dev/workoutplanner/"
    ]) {
      const response = await request(route);
      assert.strictEqual(response.status, 302, `${route} should redirect unauthenticated visitors to Admin sign-in`);
      assert.match(response.headers.get("location"), /^\/admin\?next=/);
    }

    const deniedAsset = await request("/dashboard/workoutplanner-unified-mock/unified.js");
    assert.strictEqual(deniedAsset.status, 401, "preview assets should deny unauthenticated requests");

    const login = await fetch(new URL("/api/admin/login", baseUrl), {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: environment.ADMIN_PASSWORD })
    });
    assert.strictEqual(login.status, 200, "the existing Admin sign-in should still issue a session");
    const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
    assert.match(cookie, /^halsopulsen_admin_session=/);

    const unified = await request("/admin/workoutplanner-preview", cookie);
    assert.strictEqual(unified.status, 200);
    assert.match(unified.headers.get("cache-control"), /no-store/);
    assert.match(unified.headers.get("x-robots-tag"), /noindex, nofollow/);
    assert.match(await unified.text(), /data-role="coach"/);

    const showroom = await request("/admin/workoutplanner-showroom", cookie);
    assert.strictEqual(showroom.status, 200);
    assert.match(showroom.headers.get("cache-control"), /no-store/);
    assert.match(showroom.headers.get("x-robots-tag"), /noindex, nofollow/);
    assert.match(await showroom.text(), /Sample data, by design/);

    const embeddedClientPlanning = await request(
      "/__dev/workoutplanner/client-planning/?embed=1&unified=1&workspace=planning",
      cookie
    );
    assert.strictEqual(embeddedClientPlanning.status, 200);
    assert.match(await embeddedClientPlanning.text(), /workoutplanner-unified-mock\/workout-data\.js/);
    assert.match(embeddedClientPlanning.headers.get("cache-control"), /no-store/);

    const embeddedTimeline = await request("/__dev/workoutplanner/planning/", cookie);
    assert.strictEqual(embeddedTimeline.status, 200);
    assert.match(await embeddedTimeline.text(), /MOCK DATA PREVIEW/i);

    for (const asset of [
      "/dashboard/workoutplanner-unified-mock/unified.js",
      "/dashboard/workoutplanner-unified-mock/workout-data.js",
      "/dashboard/workoutplanner-showroom/showroom.css",
      "/dashboard/workoutplanner-planning-prototype/planning.js",
      "/dashboard/workoutplanner-mock-preview.js",
      "/dashboard/client-planner-mock-preview.js",
      "/workoutplanner/mock-preview-harness.js"
    ]) {
      const response = await request(asset, cookie);
      assert.strictEqual(response.status, 200, `${asset} should load for the signed-in Admin`);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.match(response.headers.get("x-robots-tag"), /noindex, nofollow/);
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function run() {
  testProductionPreviewAccessRequiresTheAdminSession();
  testDevelopmentPreviewGateRemainsUnchanged();
  testAdminNavigationAndRouteWiring();
  await testHttpRoutesUseTheExistingAdminSession();
  console.log("WorkoutPlanner Admin preview access checks passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
