const { Pool } = require("pg");

let pool;

function getConnectionString() {
  return (
    process.env.WORKOUTPLANNER_POSTGRES_URL ||
    process.env.WORKOUTPLANNER_DATABASE_URL ||
    ""
  );
}

function isConfigured() {
  return Boolean(getConnectionString());
}

function getPool() {
  if (!pool) {
    const rawConnectionString = getConnectionString();
    if (!rawConnectionString) {
      throw new Error(
        "WORKOUTPLANNER_POSTGRES_URL or WORKOUTPLANNER_DATABASE_URL is required for WorkoutPlanner database access."
      );
    }

    let connectionString = rawConnectionString;
    try {
      const parsed = new URL(rawConnectionString);
      parsed.searchParams.delete("sslmode");
      parsed.searchParams.delete("uselibpqcompat");
      connectionString = parsed.toString();
    } catch {
      // pg will report malformed connection strings with the useful details.
    }

    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000
    });
  }

  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = {
  closePool,
  getPool,
  isConfigured
};