const assert = require("assert");
const fs = require("fs");
const path = require("path");

const migrationName = "012_stage1-session-integrity.sql";
const migrationPath = path.join(
  __dirname,
  "..",
  "db",
  "workoutplanner-migrations",
  migrationName
);
const migrationDirectory = path.dirname(migrationPath);

function requireMatch(source, expression, message) {
  assert.match(source, expression, message);
}

function run() {
  assert.ok(fs.existsSync(migrationPath), `Expected ${migrationName}.`);

  const migrations = fs
    .readdirSync(migrationDirectory)
    .filter(file => /^\d+_[a-z0-9-]+\.sql$/i.test(file))
    .sort();
  assert.strictEqual(migrations[migrations.length - 1], migrationName);

  const sql = fs.readFileSync(migrationPath, "utf8");
  const normalized = sql.replace(/\s+/g, " ").toLowerCase();

  requireMatch(
    sql,
    /^\s*(?:--[^\n]*\n\s*)*begin\s*;/i,
    "Migration must start transactionally."
  );
  requireMatch(sql, /commit\s*;\s*$/i, "Migration must commit transactionally.");
  assert.doesNotMatch(
    sql,
    /^\s*(?:insert\s+into\b|update\b|delete\s+from\b|truncate\b|drop\s+table\b)/im,
    "Migration must not rewrite or delete existing data."
  );

  requireMatch(
    normalized,
    /add column revision bigint not null default 0[\s\S]*?programs_revision_nonnegative[\s\S]*?check \(revision >= 0\)/,
    "Programs need a nonnegative revision initialized to zero."
  );
  requireMatch(
    normalized,
    /add column workout_id uuid[\s\S]*?foreign key \(workout_id\)[\s\S]*?references public\.workouts\(id\)[\s\S]*?on delete restrict/,
    "Sessions need a deletion-protected workout reference."
  );
  requireMatch(
    normalized,
    /alter column client_id drop not null/,
    "Direct-link and standalone sessions must not require a client row."
  );
  requireMatch(
    normalized,
    /status in\s*\(\s*'in_progress', 'recorded', 'partial', 'completed', 'cancelled', 'done', 'skipped'\s*\)/,
    "The new states must preserve every legacy session status."
  );

  requireMatch(
    normalized,
    /create trigger program_versions_protect_lifecycle before insert or update or delete/,
    "Program versions need lifecycle protection for inserts, updates, and deletes."
  );
  requireMatch(
    normalized,
    /old\.status = 'published' and new\.status = 'archived'/,
    "Published versions must retain the supported archive transition."
  );
  requireMatch(
    normalized,
    /create trigger program_weeks_protect_version_content before insert or update or delete/,
    "Weeks need version-content protection."
  );
  requireMatch(
    normalized,
    /create trigger workouts_protect_version_content before insert or update or delete/,
    "Workouts need version-content protection."
  );
  requireMatch(
    normalized,
    /create trigger workout_exercises_protect_version_content before insert or update or delete/,
    "Prescriptions need version-content protection."
  );
  requireMatch(
    normalized,
    /before truncate on public\.program_versions/,
    "Published content protection must also prevent TRUNCATE bypasses."
  );

  requireMatch(
    normalized,
    /add column activity_name text not null default ''/,
    "Standalone session exercises need a user-entered activity name."
  );
  requireMatch(
    normalized,
    /exercise_id is not null or length\(btrim\(activity_name\)\) > 0/,
    "A custom activity must have a nonblank name."
  );
  requireMatch(
    normalized,
    /new\.workout_exercise_id is null or new\.exercise_id is null/,
    "Planned exercises must provide a prescription reference and stable exercise ID."
  );
  requireMatch(
    normalized,
    /we\.workout_id = effective_workout_id and we\.exercise_id = new\.exercise_id/,
    "Planned exercise references must match the session workout and exercise."
  );

  const metrics = [
    ["reps", null],
    ["duration", "duration_unit"],
    ["distance", "distance_unit"],
    ["load", "load_unit"],
    ["rir", null],
    ["intensity", "intensity_unit"]
  ];
  for (const [metric, unit] of metrics) {
    requireMatch(
      normalized,
      new RegExp(`add column ${metric}_provenance text not null default 'unknown'`),
      `${metric} needs unknown provenance by default.`
    );
    requireMatch(
      normalized,
      new RegExp(`${metric}_provenance in \\('reported', 'assumed', 'unknown'\\)`),
      `${metric} provenance needs the three approved values.`
    );
    requireMatch(
      normalized,
      new RegExp(`\\(${metric} is not null or ${metric}_provenance = 'unknown'\\)`),
      `NULL ${metric} values must have unknown provenance.`
    );
    requireMatch(
      normalized,
      new RegExp(`${metric}_provenance <> 'assumed' or ${metric} is not null`),
      `Assumed ${metric} values must be non-NULL.`
    );
    requireMatch(
      normalized,
      new RegExp(`new\\.${metric}_provenance = 'assumed'[\\s\\S]*?prescription\\.${metric} is null[\\s\\S]*?new\\.${metric} is distinct from prescription\\.${metric}`),
      `Assumed ${metric} values must match a non-NULL prescription.`
    );
    if (unit) {
      requireMatch(
        normalized,
        new RegExp(`new\\.${unit} is distinct from prescription\\.${unit}`),
        `Assumed ${metric} units must match their prescription.`
      );
    }
  }
  requireMatch(
    normalized,
    /standalone activities cannot use assumed prescription values/,
    "Standalone activities must reject assumed prescription metrics."
  );

  assert.doesNotMatch(
    normalized,
    /alter table public\.client_access_links|alter table public\.assignments|\/plans/,
    "The migration must leave private-link rows, assignments, and legacy /plans untouched."
  );
  assert.doesNotMatch(
    sql,
    /require\(["'](?:pg|\.{1,2}\/workoutplanner\/db)["']\)/,
    "Static checks must not connect to a database."
  );

  console.log(`WorkoutPlanner Stage 1 migration static checks passed (${migrationName}).`);
}

run();
