const assert = require("assert");
const Module = require("module");

const createdPools = [];

class StubPool {
  constructor(options) {
    this.options = options;
    createdPools.push(this);
  }

  async end() {}
}

const originalLoad = Module._load;
Module._load = function loadWithStubbedPg(request, parent, isMain) {
  if (request === "pg") return { Pool: StubPool };
  return originalLoad.call(this, request, parent, isMain);
};

const database = require("../workoutplanner/db");
Module._load = originalLoad;

const managedEnvironmentKeys = [
  "NODE_ENV",
  "WORKOUTPLANNER_DATABASE_TARGET",
  "WORKOUTPLANNER_DATABASE_URL_DIRECT",
  "WORKOUTPLANNER_DATABASE_URL",
  "WORKOUTPLANNER_TEST_DATABASE_URL"
];

function setEnvironment(values) {
  for (const key of managedEnvironmentKeys) delete process.env[key];
  Object.assign(process.env, values);
}

async function resetPool() {
  await database.closePool();
  createdPools.length = 0;
}

async function testTestModeUsesOnlyTheTestUrl() {
  setEnvironment({
    NODE_ENV: "test",
    WORKOUTPLANNER_DATABASE_TARGET: "direct",
    WORKOUTPLANNER_DATABASE_URL_DIRECT: "postgres://live.invalid/live",
    WORKOUTPLANNER_DATABASE_URL: "postgres://inactive.invalid/inactive",
    WORKOUTPLANNER_TEST_DATABASE_URL: "postgres://test.invalid/test"
  });

  assert.strictEqual(database.isConfigured(), true);
  const pool = database.getPool();
  assert.strictEqual(pool.options.connectionString, "postgres://test.invalid/test");
  assert.strictEqual(createdPools.length, 1);
  await resetPool();
}

async function testTestModeDoesNotFallBackToProductionUrls() {
  setEnvironment({
    NODE_ENV: "test",
    WORKOUTPLANNER_DATABASE_TARGET: "direct",
    WORKOUTPLANNER_DATABASE_URL_DIRECT: "postgres://live.invalid/live",
    WORKOUTPLANNER_DATABASE_URL: "postgres://inactive.invalid/inactive"
  });

  assert.strictEqual(database.isConfigured(), false);
  assert.throws(
    () => database.getPool(),
    /WORKOUTPLANNER_TEST_DATABASE_URL is required in test mode/
  );
  assert.strictEqual(createdPools.length, 0);
  await resetPool();
}

async function testExplicitDirectTargetUsesOnlyTheDirectUrl() {
  setEnvironment({
    NODE_ENV: "production",
    WORKOUTPLANNER_DATABASE_TARGET: "direct",
    WORKOUTPLANNER_DATABASE_URL_DIRECT: "postgres://live.invalid/live",
    WORKOUTPLANNER_DATABASE_URL: "postgres://inactive.invalid/inactive"
  });

  assert.strictEqual(database.isConfigured(), true);
  const pool = database.getPool();
  assert.strictEqual(pool.options.connectionString, "postgres://live.invalid/live");
  assert.strictEqual(createdPools.length, 1);
  await resetPool();
}

async function testMissingDirectUrlFailsWithoutLegacyFallback() {
  setEnvironment({
    NODE_ENV: "production",
    WORKOUTPLANNER_DATABASE_TARGET: "direct",
    WORKOUTPLANNER_DATABASE_URL: "postgres://inactive.invalid/inactive"
  });

  assert.strictEqual(database.isConfigured(), false);
  assert.throws(
    () => database.getPool(),
    /WORKOUTPLANNER_DATABASE_URL_DIRECT is required when WORKOUTPLANNER_DATABASE_TARGET=direct/
  );
  assert.strictEqual(createdPools.length, 0);
  await resetPool();
}

async function testProductionWithoutSelectorKeepsTheLegacyUrl() {
  setEnvironment({
    NODE_ENV: "production",
    WORKOUTPLANNER_DATABASE_URL_DIRECT: "postgres://live.invalid/live",
    WORKOUTPLANNER_DATABASE_URL: "postgres://inactive.invalid/inactive"
  });

  const pool = database.getPool();
  assert.strictEqual(pool.options.connectionString, "postgres://inactive.invalid/inactive");
  assert.strictEqual(createdPools.length, 1);
  await resetPool();
}

async function testDevelopmentKeepsTheLegacyUrlUnlessDirectIsSelected() {
  setEnvironment({
    NODE_ENV: "development",
    WORKOUTPLANNER_DATABASE_URL_DIRECT: "postgres://live.invalid/live",
    WORKOUTPLANNER_DATABASE_URL: "postgres://development.invalid/development"
  });

  const pool = database.getPool();
  assert.strictEqual(pool.options.connectionString, "postgres://development.invalid/development");
  assert.strictEqual(createdPools.length, 1);
  await resetPool();
}

async function run() {
  await testTestModeUsesOnlyTheTestUrl();
  await testTestModeDoesNotFallBackToProductionUrls();
  await testExplicitDirectTargetUsesOnlyTheDirectUrl();
  await testMissingDirectUrlFailsWithoutLegacyFallback();
  await testProductionWithoutSelectorKeepsTheLegacyUrl();
  await testDevelopmentKeepsTheLegacyUrlUnlessDirectIsSelected();
  console.log("WorkoutPlanner database target selection checks passed.");
}

run().catch(async error => {
  await resetPool();
  console.error(error.message);
  process.exitCode = 1;
});
