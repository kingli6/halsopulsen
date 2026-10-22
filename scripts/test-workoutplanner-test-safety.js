const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  assertWorkoutPlannerTestTargetIsDistinct,
  compareWorkoutPlannerTestTarget
} = require("./workoutplanner-test-safety");

const testTarget = "postgresql://test_user:TestPass-123@test-db.example:5432/workoutplanner_test";

function testMatchingTargetsAreBlockedWithoutLeakingConnectionDetails() {
  const environment = {
    WORKOUTPLANNER_TEST_DATABASE_URL: testTarget,
    WORKOUTPLANNER_DATABASE_URL: "postgres://prod_user:ProdPass-456@TEST-DB.EXAMPLE/workoutplanner_test"
  };

  assert.strictEqual(compareWorkoutPlannerTestTarget(environment).status, "matching");
  assert.throws(
    () => assertWorkoutPlannerTestTargetIsDistinct(environment),
    error => {
      assert.match(error.message, /match an application database target/);
      assert.doesNotMatch(error.message, /test_user|prod_user|TestPass-123|ProdPass-456|test-db\.example/);
      return true;
    }
  );
}

function testDistinctTargetsAreAllowed() {
  const environment = {
    WORKOUTPLANNER_TEST_DATABASE_URL: testTarget,
    WORKOUTPLANNER_POSTGRES_URL: "postgresql://prod_user:ProdPass-456@prod-db.example:6543/workoutplanner",
    WORKOUTPLANNER_DATABASE_URL: "postgres://other_user:OtherPass-789@other-db.example/app"
  };

  assert.strictEqual(compareWorkoutPlannerTestTarget(environment).status, "distinct");
  assert.doesNotThrow(() => assertWorkoutPlannerTestTargetIsDistinct(environment));
}

function testEveryAvailableApplicationTargetIsCompared() {
  const environment = {
    WORKOUTPLANNER_TEST_DATABASE_URL: testTarget,
    WORKOUTPLANNER_POSTGRES_URL: "postgres://prod_user:secret@prod-db.example/workoutplanner",
    WORKOUTPLANNER_DATABASE_URL: "postgres://other_user:secret@test-db.example/workoutplanner_test"
  };

  assert.strictEqual(compareWorkoutPlannerTestTarget(environment).status, "matching");
  assert.throws(() => assertWorkoutPlannerTestTargetIsDistinct(environment));
}

function testMissingTargetsRequireExternalVerification() {
  assert.strictEqual(
    compareWorkoutPlannerTestTarget({ WORKOUTPLANNER_TEST_DATABASE_URL: testTarget }).status,
    "unverified"
  );
  assert.strictEqual(
    compareWorkoutPlannerTestTarget({ WORKOUTPLANNER_DATABASE_URL: testTarget }).status,
    "unverified"
  );
  assert.throws(
    () => assertWorkoutPlannerTestTargetIsDistinct({
      WORKOUTPLANNER_TEST_DATABASE_URL: testTarget
    }),
    /external verification is required/
  );
}

function testUnparseableIdentifiersRequireExternalVerification() {
  assert.strictEqual(
    compareWorkoutPlannerTestTarget({
      WORKOUTPLANNER_TEST_DATABASE_URL: "not-a-postgres-url",
      WORKOUTPLANNER_DATABASE_URL: "postgres://prod@prod-db.example/workoutplanner"
    }).status,
    "unverified"
  );
  assert.strictEqual(
    compareWorkoutPlannerTestTarget({
      WORKOUTPLANNER_TEST_DATABASE_URL: testTarget,
      WORKOUTPLANNER_DATABASE_URL: "not-a-postgres-url"
    }).status,
    "unverified"
  );
  assert.throws(
    () => assertWorkoutPlannerTestTargetIsDistinct({
      WORKOUTPLANNER_TEST_DATABASE_URL: testTarget,
      WORKOUTPLANNER_DATABASE_URL: "not-a-postgres-url"
    }),
    /external verification is required/
  );
}

function testDatabaseWritingScriptsRunTheGuardBeforeConnecting() {
  const publishScript = fs.readFileSync(
    path.join(__dirname, "test-workoutplanner-publish.js"),
    "utf8"
  );
  const sessionScript = fs.readFileSync(
    path.join(__dirname, "test-workoutplanner-session-integration.js"),
    "utf8"
  );
  const hardeningScript = fs.readFileSync(
    path.join(__dirname, "test-workoutplanner-session-hardening.js"),
    "utf8"
  );
  const pass3Script = fs.readFileSync(
    path.join(__dirname, "test-workoutplanner-pass3.js"),
    "utf8"
  );

  const publishGuard = publishScript.indexOf("assertWorkoutPlannerTestTargetIsDistinct()");
  const publishConnection = publishScript.indexOf("createRollbackTestDatabase()");
  assert.ok(publishGuard >= 0 && publishGuard < publishConnection);

  const sessionGuard = sessionScript.indexOf("assertWorkoutPlannerTestTargetIsDistinct()");
  const sessionConnection = sessionScript.indexOf("new Pool(");
  assert.ok(sessionGuard >= 0 && sessionGuard < sessionConnection);

  const hardeningGuard = hardeningScript.indexOf("assertWorkoutPlannerTestTargetIsDistinct()");
  const hardeningConnection = hardeningScript.indexOf("createRollbackTestDatabase()");
  assert.ok(hardeningGuard >= 0 && hardeningGuard < hardeningConnection);

  const pass3Guard = pass3Script.indexOf("assertWorkoutPlannerTestTargetIsDistinct()");
  const pass3Connection = pass3Script.indexOf("createRollbackTestDatabase()");
  assert.ok(pass3Guard >= 0 && pass3Guard < pass3Connection);
}

function testRuntimeTargetSelectionDoesNotChangeMigrationTarget() {
  const runtimeDb = fs.readFileSync(
    path.join(__dirname, "..", "workoutplanner", "db.js"),
    "utf8"
  );
  const migrationRunner = fs.readFileSync(
    path.join(__dirname, "migrate-workoutplanner.js"),
    "utf8"
  );

  assert.match(runtimeDb, /process\.env\.WORKOUTPLANNER_DATABASE_TARGET\s*===\s*["']direct["']/);
  assert.match(runtimeDb, /process\.env\.WORKOUTPLANNER_DATABASE_URL_DIRECT/);
  assert.match(runtimeDb, /process\.env\.WORKOUTPLANNER_TEST_DATABASE_URL/);
  assert.match(runtimeDb, /process\.env\.WORKOUTPLANNER_DATABASE_URL/);
  assert.doesNotMatch(runtimeDb, /process\.env\.WORKOUTPLANNER_POSTGRES_URL/);

  assert.match(migrationRunner, /process\.env\.WORKOUTPLANNER_DATABASE_URL/);
  assert.doesNotMatch(migrationRunner, /process\.env\.WORKOUTPLANNER_DATABASE_URL_DIRECT/);
  assert.doesNotMatch(migrationRunner, /process\.env\.WORKOUTPLANNER_DATABASE_TARGET/);
  assert.doesNotMatch(migrationRunner, /process\.env\.WORKOUTPLANNER_POSTGRES_URL/);
}

function testMigrationStatusDiagnosticIsReadOnlyAndUsesOnlyCanonicalUrl() {
  const diagnostic = fs.readFileSync(
    path.join(__dirname, "status-workoutplanner-migrations.js"),
    "utf8"
  );
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "package.json"),
    "utf8"
  ));

  assert.match(diagnostic, /process\.env\.WORKOUTPLANNER_DATABASE_URL/);
  assert.doesNotMatch(
    diagnostic,
    /process\.env\.(?:WORKOUTPLANNER_TEST_DATABASE_URL|WORKOUTPLANNER_POSTGRES_URL|SUPABASE_DATABASE_URL)/
  );
  assert.match(
    diagnostic,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/i
  );
  assert.match(diagnostic, /pendingMigrations/);
  assert.doesNotMatch(
    diagnostic,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|CREATE\s+(?:SCHEMA|TABLE)|ALTER\s+TABLE|DROP\s+(?:TABLE|SCHEMA))\b/im
  );
  assert.strictEqual(
    packageJson.scripts["db:status:workoutplanner"],
    "node scripts/status-workoutplanner-migrations.js"
  );
}

function run() {
  testMatchingTargetsAreBlockedWithoutLeakingConnectionDetails();
  testDistinctTargetsAreAllowed();
  testEveryAvailableApplicationTargetIsCompared();
  testMissingTargetsRequireExternalVerification();
  testUnparseableIdentifiersRequireExternalVerification();
  testDatabaseWritingScriptsRunTheGuardBeforeConnecting();
  testRuntimeTargetSelectionDoesNotChangeMigrationTarget();
  testMigrationStatusDiagnosticIsReadOnlyAndUsesOnlyCanonicalUrl();
  console.log("WorkoutPlanner test-target safety checks passed.");
}

run();
