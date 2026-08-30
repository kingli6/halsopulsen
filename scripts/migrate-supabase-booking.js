const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const migrationsDirectory = path.join(
  __dirname,
  "..",
  "db",
  "supabase-migrations"
);

function getSupabaseConnectionString() {
  const connectionString = process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SUPABASE_DATABASE_URL is required; refusing to fall back to DATABASE_URL."
    );
  }
  return connectionString;
}

function getPool() {
  const rawConnectionString = getSupabaseConnectionString();
  let connectionString = rawConnectionString;

  // Supabase pooler URLs in this environment use sslmode=require, while the
  // pooler's certificate chain is not trusted by the workspace CA bundle.
  // Keep TLS enabled but avoid silently falling back to an unencrypted socket.
  try {
    const parsed = new URL(rawConnectionString);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("uselibpqcompat");
    connectionString = parsed.toString();
  } catch {
    // pg will provide the detailed connection-string error below.
  }

  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000
  });
}

async function run() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [814725190]);
    for (const filename of fs.readdirSync(migrationsDirectory)
      .filter(file => /^\d+_[a-z0-9-]+\.sql$/i.test(file))
      .sort()) {
      const applied = await client.query(
        "SELECT 1 FROM booking.schema_migrations WHERE filename = $1",
        [filename]
      );
      if (applied.rowCount > 0) continue;

      const sql = fs.readFileSync(path.join(migrationsDirectory, filename), "utf8");
      await client.query(sql);
      console.log(`Applied Supabase booking migration: ${filename}`);
    }
    await client.query("SELECT pg_advisory_unlock($1)", [814725190]);
    console.log("Supabase booking migrations are up to date.");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [814725190]).catch(() => {});
    client.release();
    await pool.end();
  }
}

run().catch(error => {
  console.error(`Supabase booking migration failed: ${error.message}`);
  process.exitCode = 1;
});