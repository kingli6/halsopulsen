const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const migrationPath = path.join(
  __dirname,
  "..",
  "db",
  "supabase-migrations",
  "001_booking.sql"
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
  const sql = fs.readFileSync(migrationPath, "utf8");
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query(sql);
    console.log("Supabase booking migration applied.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(error => {
  console.error(`Supabase booking migration failed: ${error.message}`);
  process.exitCode = 1;
});