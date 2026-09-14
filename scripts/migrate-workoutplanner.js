const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const migrationsDirectory = path.join(
  __dirname,
  "..",
  "db",
  "workoutplanner-migrations"
);
const migrationTable = "private.workoutplanner_schema_migrations";

function getWorkoutPlannerConnectionString() {
  const connectionString =
    process.env.WORKOUTPLANNER_POSTGRES_URL ||
    process.env.WORKOUTPLANNER_DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "WORKOUTPLANNER_POSTGRES_URL or WORKOUTPLANNER_DATABASE_URL is required; refusing to fall back to a booking or development database."
    );
  }

  return connectionString;
}

function getPool() {
  const rawConnectionString = getWorkoutPlannerConnectionString();
  let connectionString = rawConnectionString;

  try {
    const parsed = new URL(rawConnectionString);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("uselibpqcompat");
    connectionString = parsed.toString();
  } catch {
    // pg will report malformed connection strings with the useful details.
  }

  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000
  });
}

function getMigrationFiles() {
  return fs
    .readdirSync(migrationsDirectory)
    .filter(file => /^\d+_[a-z0-9-]+\.sql$/i.test(file))
    .sort();
}

async function run() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [493817206]);
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS private;
      CREATE TABLE IF NOT EXISTS ${migrationTable} (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    for (const filename of getMigrationFiles()) {
      const applied = await client.query(
        `SELECT 1 FROM ${migrationTable} WHERE filename = $1`,
        [filename]
      );
      if (applied.rowCount > 0) continue;

      const sql = fs.readFileSync(
        path.join(migrationsDirectory, filename),
        "utf8"
      );
      await client.query(sql);
      await client.query(
        `INSERT INTO ${migrationTable} (filename) VALUES ($1)`,
        [filename]
      );
      console.log(`Applied WorkoutPlanner migration: ${filename}`);
    }

    console.log("WorkoutPlanner migrations are up to date.");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [493817206]).catch(() => {});
    client.release();
    await pool.end();
  }
}

run().catch(error => {
  console.error(`WorkoutPlanner migration failed: ${error.message}`);
  process.exitCode = 1;
});