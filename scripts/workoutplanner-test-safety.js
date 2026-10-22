const TEST_DATABASE_ENV = "WORKOUTPLANNER_TEST_DATABASE_URL";
const APPLICATION_DATABASE_ENVS = [
  "WORKOUTPLANNER_DATABASE_URL_DIRECT",
  "WORKOUTPLANNER_POSTGRES_URL",
  "WORKOUTPLANNER_DATABASE_URL"
];
const ENDPOINT_OVERRIDE_PARAMS = [
  "host",
  "hostaddr",
  "port",
  "dbname",
  "database",
  "service"
];

function parseConnectionIdentifiers(connectionString) {
  if (typeof connectionString !== "string" || !connectionString.trim()) return null;

  let parsed;
  try {
    parsed = new URL(connectionString.trim());
  } catch {
    return null;
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hash
    || ENDPOINT_OVERRIDE_PARAMS.some(key => parsed.searchParams.has(key))
  ) {
    return null;
  }

  const host = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host || host.includes(",")) return null;

  const port = Number(parsed.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const encodedDatabase = parsed.pathname.startsWith("/")
    ? parsed.pathname.slice(1)
    : "";
  if (!encodedDatabase || encodedDatabase.includes("/")) return null;

  let database;
  try {
    database = decodeURIComponent(encodedDatabase);
  } catch {
    return null;
  }
  if (!database.trim()) return null;

  return { host, port, database };
}

function sameConnectionTarget(left, right) {
  return left.host === right.host
    && left.port === right.port
    && left.database === right.database;
}

function compareWorkoutPlannerTestTarget(environment = process.env) {
  const testConnectionString = environment[TEST_DATABASE_ENV];
  if (!testConnectionString) {
    return { status: "unverified", reason: "missing-test-target" };
  }

  const testIdentifiers = parseConnectionIdentifiers(testConnectionString);
  if (!testIdentifiers) {
    return { status: "unverified", reason: "unparseable-test-identifiers" };
  }

  const applicationTargets = APPLICATION_DATABASE_ENVS
    .map(key => environment[key])
    .filter(value => typeof value === "string" && value.trim());
  if (!applicationTargets.length) {
    return { status: "unverified", reason: "missing-application-target" };
  }

  let hasUnparseableApplicationTarget = false;
  for (const applicationTarget of applicationTargets) {
    const applicationIdentifiers = parseConnectionIdentifiers(applicationTarget);
    if (!applicationIdentifiers) {
      hasUnparseableApplicationTarget = true;
      continue;
    }
    if (sameConnectionTarget(testIdentifiers, applicationIdentifiers)) {
      return { status: "matching" };
    }
  }

  if (hasUnparseableApplicationTarget) {
    return { status: "unverified", reason: "unparseable-application-identifiers" };
  }

  return { status: "distinct" };
}

function assertWorkoutPlannerTestTargetIsDistinct(environment = process.env) {
  const comparison = compareWorkoutPlannerTestTarget(environment);
  if (comparison.status === "matching") {
    throw new Error(
      "WorkoutPlanner database-writing test blocked: test identifiers match an application database target."
    );
  }
  if (comparison.status !== "distinct") {
    throw new Error(
      "WorkoutPlanner database-writing test blocked: target separation could not be verified from available connection identifiers; external verification is required."
    );
  }
}

module.exports = {
  assertWorkoutPlannerTestTargetIsDistinct,
  compareWorkoutPlannerTestTarget
};
