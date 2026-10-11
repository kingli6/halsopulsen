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
  requireMatch(
    normalized,
    /if exists \(select 1 from public\.workout_sessions\)[\s\S]*?raise exception[\s\S]*?trustworthy performance date/,
    "Migration must not fabricate dates for existing sessions."
  );

  requireMatch(
    normalized,
    /add column revision bigint not null default 0[\s\S]*?programs_revision_nonnegative check \(revision >= 0\)/,
    "Programs need a nonnegative revision initialized to zero."
  );
  requireMatch(
    normalized,
    /add column current_version_id uuid[\s\S]*?programs_current_version_fkey foreign key \(id, current_version_id\) references public\.program_versions \(program_id, id\) deferrable initially deferred/,
    "A program's current version must be explicitly referenced and belong to that program."
  );
  requireMatch(
    normalized,
    /unique \(program_id, id\)[\s\S]*?update public\.programs p set current_version_id = \([\s\S]*?order by pv\.version_number desc/,
    "Existing program version history must initialize the current-version pointer."
  );
  requireMatch(
    normalized,
    /create unique index program_versions_one_published_per_program_idx[\s\S]*?where status = 'published'/,
    "At most one version per program may retain the current/published history label."
  );

  requireMatch(
    normalized,
    /create trigger program_versions_protect_lifecycle before insert or update or delete/,
    "Current and historical program versions need basic lifecycle protection."
  );
  requireMatch(
    normalized,
    /create trigger program_weeks_protect_version_content[\s\S]*?create trigger workouts_protect_version_content[\s\S]*?create trigger workout_exercises_protect_version_content/,
    "Program content must become immutable after its version is saved."
  );
  assert.doesNotMatch(
    normalized,
    /nowait|for update|for share|before truncate|assert_program_week_version|assert_workout_program_week/,
    "Version immutability must not reintroduce elaborate locking or membership-recheck machinery."
  );

  requireMatch(
    normalized,
    /alter column client_id drop not null/,
    "A session must not require a client account."
  );
  requireMatch(
    normalized,
    /add column performed_on date not null/,
    "Sessions need an explicit performance date."
  );
  assert.doesNotMatch(
    normalized,
    /add column performed_on date not null default|update public\.workout_sessions[\s\S]*?set performed_on/,
    "Performance dates must not be inferred from creation timestamps."
  );
  requireMatch(
    normalized,
    /add column program_id uuid[\s\S]*?add column workout_id uuid[\s\S]*?foreign key \(program_id\)[\s\S]*?references public\.programs \(id\)[\s\S]*?on delete restrict[\s\S]*?foreign key \(workout_id\)[\s\S]*?references public\.workouts \(id\)[\s\S]*?on delete restrict/,
    "Sessions need durable program/workout references."
  );
  requireMatch(
    normalized,
    /check \(status in \('completed', 'skipped'\)\)/,
    "Session status must be limited to completed and skipped."
  );
  assert.doesNotMatch(
    normalized,
    /status in\s*\([^)]*'done'|status in\s*\([^)]*'cancelled'|status in\s*\([^)]*'partial'|status in\s*\([^)]*'in_progress'/,
    "The new session schema must not retain unused status concepts."
  );

  requireMatch(
    normalized,
    /alter column exercise_id drop not null[\s\S]*?add column activity_name text not null default ''/,
    "Session activities must support free-text entries without a catalog exercise."
  );
  requireMatch(
    normalized,
    /foreign key \(workout_exercise_id, exercise_id\) references public\.workout_exercises \(id, exercise_id\) on delete restrict/,
    "A planned session exercise must preserve its exact prescription and stable exercise identity."
  );
  requireMatch(
    normalized,
    /exercise_id is not null or length\(btrim\(activity_name\)\) > 0/,
    "Unplanned exercises need either a catalog exercise or a nonblank activity name."
  );

  assert.doesNotMatch(
    normalized,
    /provenance|assumed|assert_session_set|update public\.session_sets|insert into public\.session_sets/,
    "Migration must not add value provenance or copy prescriptions into actuals."
  );
  assert.doesNotMatch(
    normalized,
    /alter table public\.(client_access_links|assignments)|\/plans/,
    "Migration must leave private links, assignments, and legacy /plans untouched."
  );
  assert.doesNotMatch(
    sql,
    /require\(["'](?:pg|\.{1,2}\/workoutplanner\/db)["']\)/,
    "Static checks must not connect to a database."
  );

  console.log(`WorkoutPlanner Step 1 migration static checks passed (${migrationName}).`);
}

run();
