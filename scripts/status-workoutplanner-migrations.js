const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const migrationsDirectory = path.join(
  __dirname,
  "..",
  "db",
  "workoutplanner-migrations"
);

const foundationMigration = "001_initial-foundation.sql";
const migration013 = "013_prescription-names-client-identities.sql";
const migration014 = "014_repair-prescription-name-column.sql";

const foundationTables = [
  "profiles",
  "clients",
  "coach_clients",
  "exercises",
  "programs",
  "program_versions",
  "program_weeks",
  "workouts",
  "workout_exercises",
  "assignments",
  "workout_sessions",
  "session_exercises",
  "session_sets"
];

const expectedConstraints = [
  ["workout_exercises", "workout_exercises_exercise_name_not_blank"],
  ["session_exercises", "session_exercises_prescription_fkey"],
  ["session_exercises", "session_exercises_client_exercise_fkey"],
  ["session_exercises", "session_exercises_activity_name_not_blank"],
  ["client_exercises", "client_exercises_client_name_unique"]
];

const expectedTriggers = [
  ["client_exercises", "client_exercises_set_updated_at"],
  ["session_exercises", "session_exercises_validate_scope"],
  ["session_sets", "session_sets_validate_scope"]
];

const expectedPolicies = [
  ["client_exercises", "client_exercises_select"],
  ["client_exercises", "client_exercises_insert"],
  ["session_exercises", "session_exercises_insert"],
  ["session_exercises", "session_exercises_update"]
];

function getMigrationFiles() {
  return fs
    .readdirSync(migrationsDirectory)
    .filter(file => /^\d+_[a-z0-9-]+\.sql$/i.test(file))
    .sort();
}

function createPool() {
  const rawConnectionString = process.env.WORKOUTPLANNER_DATABASE_URL;
  if (!rawConnectionString) return null;

  let connectionString = rawConnectionString;
  try {
    const parsed = new URL(rawConnectionString);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("uselibpqcompat");
    connectionString = parsed.toString();
  } catch {
    // pg will report malformed connection strings without exposing them here.
  }

  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000
  });
}

async function hasExistingFoundation(client) {
  const tableResult = await client.query(
    `
      SELECT count(*)::int AS table_count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [foundationTables]
  );

  if (tableResult.rows[0].table_count !== foundationTables.length) {
    return false;
  }

  const triggerResult = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = to_regclass('public.profiles')
        AND tgname = 'profiles_set_updated_at'
        AND NOT tgisinternal
    ) AS trigger_exists
  `);
  if (!triggerResult.rows[0].trigger_exists) return false;

  const foreignKeyResult = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass('public.profiles')
        AND confrelid = to_regclass('auth.users')
        AND contype = 'f'
    ) AS foreign_key_exists
  `);

  return Boolean(foreignKeyResult.rows[0].foreign_key_exists);
}

async function inspectSchema(client) {
  const columnsResult = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'workout_exercises' AND column_name IN ('exercise_name', 'exercise_id'))
        OR (table_name = 'session_exercises' AND column_name = 'client_exercise_id')
        OR (table_name = 'client_exercises' AND column_name IN ('id', 'client_id', 'name', 'normalized_name'))
      )
  `);
  const columns = new Map(
    columnsResult.rows.map(row => [`${row.table_name}.${row.column_name}`, row])
  );
  const exerciseNameColumn = columns.get("workout_exercises.exercise_name");
  const exerciseIdColumn = columns.get("workout_exercises.exercise_id");
  const sessionClientExerciseIdColumn = columns.get("session_exercises.client_exercise_id");

  const constraintsResult = await client.query(
    `
      SELECT table_info.relname AS table_name, constraint_info.conname AS constraint_name
      FROM pg_constraint constraint_info
      JOIN pg_class table_info ON table_info.oid = constraint_info.conrelid
      JOIN pg_namespace schema_info ON schema_info.oid = table_info.relnamespace
      WHERE schema_info.nspname = 'public'
        AND constraint_info.conname = ANY($1::text[])
    `,
    [expectedConstraints.map(([, name]) => name)]
  );
  const constraints = new Set(
    constraintsResult.rows.map(row => `${row.table_name}.${row.constraint_name}`)
  );

  const triggersResult = await client.query(
    `
      SELECT table_info.relname AS table_name, trigger_info.tgname AS trigger_name
      FROM pg_trigger trigger_info
      JOIN pg_class table_info ON table_info.oid = trigger_info.tgrelid
      JOIN pg_namespace schema_info ON schema_info.oid = table_info.relnamespace
      WHERE schema_info.nspname = 'public'
        AND NOT trigger_info.tgisinternal
        AND trigger_info.tgname = ANY($1::text[])
    `,
    [expectedTriggers.map(([, name]) => name)]
  );
  const triggers = new Set(
    triggersResult.rows.map(row => `${row.table_name}.${row.trigger_name}`)
  );

  const functionsResult = await client.query(
    `
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'private'
        AND routine_name = ANY($1::text[])
    `,
    [["validate_session_exercise_scope", "validate_session_set_scope"]]
  );
  const functions = new Set(functionsResult.rows.map(row => row.routine_name));

  const policiesResult = await client.query(
    `
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname = ANY($1::text[])
    `,
    [expectedPolicies.map(([, name]) => name)]
  );
  const policies = new Set(
    policiesResult.rows.map(row => `${row.tablename}.${row.policyname}`)
  );

  const relationResult = await client.query(`
    SELECT
      to_regclass('public.client_exercises') IS NOT NULL AS client_exercises_exists,
      COALESCE((
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = to_regclass('public.client_exercises')
      ), false) AS client_exercises_rls_enabled,
      to_regclass('public.session_exercises_client_exercise_idx') IS NOT NULL
        AS session_exercise_client_index_exists
  `);

  const hasExpectedItems = (items, present) => Object.fromEntries(
    items.map(([table, name]) => [`${table}.${name}`, present.has(`${table}.${name}`)])
  );

  return {
    workoutExercises: {
      exerciseName: exerciseNameColumn
        ? {
            exists: true,
            dataType: exerciseNameColumn.data_type,
            isNullable: exerciseNameColumn.is_nullable,
            matchesExpected: exerciseNameColumn.data_type === "text"
              && exerciseNameColumn.is_nullable === "NO"
          }
        : { exists: false, matchesExpected: false },
      exerciseId: exerciseIdColumn
        ? { exists: true, isNullable: exerciseIdColumn.is_nullable === "YES" }
        : { exists: false }
    },
    sessionExercises: {
      clientExerciseIdColumn: sessionClientExerciseIdColumn
        ? {
            exists: true,
            dataType: sessionClientExerciseIdColumn.data_type,
            isNullable: sessionClientExerciseIdColumn.is_nullable === "YES"
          }
        : { exists: false },
      clientExerciseIndexExists: relationResult.rows[0].session_exercise_client_index_exists,
      constraints: hasExpectedItems(expectedConstraints.slice(1, 4), constraints),
      triggers: hasExpectedItems(expectedTriggers.slice(1), triggers),
      policies: hasExpectedItems(expectedPolicies.slice(2), policies)
    },
    clientExercises: {
      tableExists: relationResult.rows[0].client_exercises_exists,
      rowLevelSecurityEnabled: relationResult.rows[0].client_exercises_rls_enabled,
      columns: Object.fromEntries(
        ["id", "client_id", "name", "normalized_name"]
          .map(name => [`${name}`, columns.has(`client_exercises.${name}`)])
      ),
      triggerExists: triggers.has("client_exercises.client_exercises_set_updated_at"),
      constraints: hasExpectedItems(expectedConstraints.slice(4), constraints),
      policies: hasExpectedItems(expectedPolicies.slice(0, 2), policies)
    },
    functions: Object.fromEntries(
      ["validate_session_exercise_scope", "validate_session_set_scope"]
        .map(name => [name, functions.has(name)])
    ),
    constraints: {
      "workout_exercises.workout_exercises_exercise_name_not_blank":
        constraints.has("workout_exercises.workout_exercises_exercise_name_not_blank")
    },
    triggers: {
      "session_sets.session_sets_validate_scope":
        triggers.has("session_sets.session_sets_validate_scope")
    }
  };
}

async function run() {
  const pool = createPool();
  if (!pool) {
    console.error(
      "WORKOUTPLANNER_DATABASE_URL is required; no database connection was attempted."
    );
    process.exitCode = 1;
    return;
  }

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;

    const migrationFiles = getMigrationFiles();
    const ledgerResult = await client.query(`
      SELECT to_regclass('private.workoutplanner_schema_migrations') IS NOT NULL
        AS ledger_exists
    `);
    const ledgerExists = ledgerResult.rows[0].ledger_exists;
    const appliedResult = ledgerExists
      ? await client.query(
          `
            SELECT filename
            FROM private.workoutplanner_schema_migrations
            WHERE filename = ANY($1::text[])
          `,
          [migrationFiles]
        )
      : { rows: [] };
    const applied = new Set(appliedResult.rows.map(row => row.filename));
    const foundationAutoDetected = !applied.has(foundationMigration)
      && await hasExistingFoundation(client);
    const pendingMigrations = migrationFiles.filter(filename =>
      !applied.has(filename)
      && !(filename === foundationMigration && foundationAutoDetected)
    );

    const report = {
      migrationLedger: {
        tableExists: ledgerExists,
        migration013Recorded: applied.has(migration013),
        migration014Recorded: applied.has(migration014)
      },
      foundation: {
        migration001Recorded: applied.has(foundationMigration),
        runnerWouldRecognizeExistingFoundation: foundationAutoDetected
      },
      migration013Schema: await inspectSchema(client),
      pendingMigrations
    };

    await client.query("COMMIT");
    transactionOpen = false;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (client) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => {});
      }
      client.release();
    }
    await pool.end();
  }
}

run().catch(error => {
  console.error("WorkoutPlanner migration status check failed; no migrations were run.");
  if (typeof error?.code === "string") {
    console.error(`Database error code: ${error.code}`);
  }
  process.exitCode = 1;
});
