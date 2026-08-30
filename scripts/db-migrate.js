const fs = require("fs");
const path = require("path");
const { getPool, closePool } = require("../booking/db");

const migrationsDirectory = path.join(__dirname, "..", "db", "migrations");

function assertDevelopmentOnly() {
  const targetEnvironment = process.env.BOOKING_DATABASE_ENV || "development";

  if (targetEnvironment !== "development") {
    throw new Error(
      "Booking migrations are development-only. Apply production schema changes through Replit Publish."
    );
  }
}

function getMigrationFiles() {
  return fs
    .readdirSync(migrationsDirectory)
    .filter(file => /^\d+_[a-z0-9-]+\.sql$/i.test(file))
    .sort();
}

async function run() {
  assertDevelopmentOnly();

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [814725190]);
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS booking;
      CREATE TABLE IF NOT EXISTS booking.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    for (const filename of getMigrationFiles()) {
      const applied = await client.query(
        "SELECT 1 FROM booking.schema_migrations WHERE filename = $1",
        [filename]
      );

      if (applied.rowCount > 0) {
        continue;
      }

      const sql = fs.readFileSync(
        path.join(migrationsDirectory, filename),
        "utf8"
      );

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO booking.schema_migrations (filename) VALUES ($1)",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`Applied booking migration: ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("Booking database migrations are up to date.");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [814725190]).catch(() => {});
    client.release();
    await closePool();
  }
}

run().catch(error => {
  console.error(`Booking migration failed: ${error.message}`);
  process.exitCode = 1;
});