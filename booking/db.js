const { Pool } = require("pg");

let pool;

function getBookingConnectionString() {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.SUPABASE_DATABASE_URL) {
      throw new Error(
        "SUPABASE_DATABASE_URL is required for production booking database access."
      );
    }
    if (process.env.BOOKING_DATABASE_URL) {
      console.warn(
        "BOOKING_DATABASE_URL is ignored in production; using SUPABASE_DATABASE_URL."
      );
    }
    return process.env.SUPABASE_DATABASE_URL;
  }

  if (process.env.BOOKING_DATABASE_URL) {
    return process.env.BOOKING_DATABASE_URL;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for development booking database access.");
  }

  return process.env.DATABASE_URL;
}

function getPool() {
  if (!pool) {
    const rawConnectionString = getBookingConnectionString();
    let connectionString = rawConnectionString;
    let usesSupabase = false;

    try {
      const parsed = new URL(rawConnectionString);
      usesSupabase = parsed.hostname.endsWith(".supabase.com");
      if (usesSupabase) {
        parsed.searchParams.delete("sslmode");
        parsed.searchParams.delete("uselibpqcompat");
        connectionString = parsed.toString();
      }
    } catch {
      // pg will report malformed connection strings when the pool connects.
    }

    pool = new Pool({
      connectionString,
      ...(usesSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000
    });
  }

  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = {
  getPool,
  query,
  closePool
};