const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  findClientDataByToken,
  generateClientAccessToken,
  hashClientAccessToken,
  revokeClientAccessLink,
  regenerateClientAccessLink
} = require("../workoutplanner/client-access");

async function run() {
  const token = generateClientAccessToken();
  assert.strictEqual(Buffer.from(token, "base64url").length, 32);
  assert.match(hashClientAccessToken(token), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(hashClientAccessToken(token), token);

  let storedValue;
  const transactionQueries = [];
  const transactionClient = {
    async query(sql, values) {
      transactionQueries.push({ sql, values });
      if (sql.includes("SELECT c.id, c.display_name")) {
        return { rowCount: 1, rows: [{ id: "client-a", display_name: "Ada" }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const generated = await regenerateClientAccessLink({
    async connect() {
      return transactionClient;
    }
  }, "coach-a", "client-a");
  assert.ok(generated.token);
  const insert = transactionQueries.find(query => query.sql.includes("INSERT INTO public.client_access_links"));
  storedValue = insert.values[1];
  assert.strictEqual(insert.values[0], "client-a");
  assert.strictEqual(insert.values[2], "coach-a");
  assert.strictEqual(storedValue, hashClientAccessToken(generated.token));
  assert.notStrictEqual(storedValue, generated.token);

  const queries = [];
  const data = await findClientDataByToken({
    async query(sql, values) {
      queries.push({ sql, values });
      if (queries.length === 1) {
        return { rowCount: 1, rows: [{ id: "client-a", display_name: "Ada", active: true }] };
      }
      return { rowCount: 1, rows: [{ id: "assignment-a", workout_name: "Strength", exercises: [] }] };
    }
  }, generated.token);
  assert.deepStrictEqual(data.client, { displayName: "Ada" });
  assert.strictEqual(data.assignments[0].id, "assignment-a");
  assert.ok(queries.slice(1).every(query => query.values.length === 1 && query.values[0] === "client-a"));

  const revokeClient = {
    async query(sql) {
      if (sql.includes("SELECT c.id, c.display_name")) {
        return { rowCount: 1, rows: [{ id: "client-a", display_name: "Ada" }] };
      }
      return { rowCount: 1, rows: [{ id: "link-a" }] };
    },
    release() {}
  };
  const revoked = await revokeClientAccessLink({
    async connect() {
      return revokeClient;
    }
  }, "coach-a", "client-a");
  assert.strictEqual(revoked.revoked, true);

  const missing = await findClientDataByToken({
    async query() {
      return { rowCount: 0, rows: [] };
    }
  }, "invalid-token");
  assert.strictEqual(missing, null);

  const migration = fs.readFileSync(
    path.join(__dirname, "..", "db", "workoutplanner-migrations", "009_private-client-access-links.sql"),
    "utf8"
  );
  assert.match(migration, /create table if not exists public\.client_access_links/);
  assert.match(migration, /token_hash text not null/);
  assert.match(migration, /client_access_links_one_active_per_client/);

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /app\.post\('\/api\/workoutplanner\/clients\/:clientId\/link'/);
  assert.match(server, /app\.delete\('\/api\/workoutplanner\/clients\/:clientId\/link'/);
  assert.match(server, /app\.get\('\/api\/client\/:token'/);
  assert.match(server, /app\.get\(\['\/p\/:token'/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.js"), "utf8"),
    /api\/plans\/share|method:\s*["'](?:PUT|POST|DELETE)|sessionList|renderSessions/
  );

  console.log("WorkoutPlanner private client-link tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});