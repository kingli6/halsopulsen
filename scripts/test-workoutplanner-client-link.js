const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  findClientDataByToken,
  generateClientAccessToken,
  hashClientAccessToken,
  regenerateClientAccessLink
} = require("../workoutplanner/client-access");

async function run() {
  const token = generateClientAccessToken();
  assert.strictEqual(Buffer.from(token, "base64url").length, 32);
  assert.match(hashClientAccessToken(token), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(hashClientAccessToken(token), token);

  let storedValue;
  const generated = await regenerateClientAccessLink({
    async query(sql, values) {
      assert.match(sql, /coach_clients/);
      storedValue = values[0];
      assert.strictEqual(values[1], "client-a");
      assert.strictEqual(values[2], "coach-a");
      return { rowCount: 1, rows: [{ id: "client-a", display_name: "Ada" }] };
    }
  }, "coach-a", "client-a");
  assert.ok(generated.token);
  assert.strictEqual(storedValue, hashClientAccessToken(generated.token));
  assert.notStrictEqual(storedValue, generated.token);

  const queries = [];
  const data = await findClientDataByToken({
    async query(sql, values) {
      queries.push({ sql, values });
      if (queries.length === 1) {
        return { rowCount: 1, rows: [{ id: "client-a", display_name: "Ada", active: true }] };
      }
      if (sql.includes("public.assignments")) {
        return { rowCount: 1, rows: [{ id: "assignment-a", workout_name: "Strength", exercises: [] }] };
      }
      return { rowCount: 1, rows: [{ id: "session-a", exercises: [] }] };
    }
  }, generated.token);
  assert.deepStrictEqual(data.client, { displayName: "Ada" });
  assert.strictEqual(data.assignments[0].id, "assignment-a");
  assert.strictEqual(data.sessions[0].id, "session-a");
  assert.ok(queries.slice(1).every(query => query.values.length === 1 && query.values[0] === "client-a"));

  const missing = await findClientDataByToken({
    async query() {
      return { rowCount: 0, rows: [] };
    }
  }, "invalid-token");
  assert.strictEqual(missing, null);

  const migration = fs.readFileSync(
    path.join(__dirname, "..", "db", "workoutplanner-migrations", "003_private-client-links.sql"),
    "utf8"
  );
  assert.match(migration, /client_access_token_hash text/);
  assert.match(migration, /unique \(client_access_token_hash\)/);

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /app\.post\('\/api\/workoutplanner\/clients\/:clientId\/link'/);
  assert.match(server, /app\.get\('\/api\/client\/:token'/);
  assert.match(server, /app\.get\(\['\/client\/:token'/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.js"), "utf8"),
    /api\/plans\/share|method:\s*["'](?:PUT|POST|DELETE)/
  );

  console.log("WorkoutPlanner private client-link tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});