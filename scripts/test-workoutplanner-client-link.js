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
        return {
          rowCount: 1,
          rows: [{
            id: "client-a",
            display_name: "Ada",
            program_id: "program-a",
            program_name: "Strength"
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const generated = await regenerateClientAccessLink(
    { async connect() { return transactionClient; } },
    "coach-a",
    "client-a",
    "program-a"
  );
  assert.ok(generated.token);
  const insert = transactionQueries.find(query => query.sql.includes("INSERT INTO public.client_access_links"));
  storedValue = insert.values[2];
  assert.strictEqual(insert.values[0], "client-a");
  assert.strictEqual(insert.values[1], "program-a");
  assert.strictEqual(insert.values[3], "coach-a");
  assert.strictEqual(storedValue, hashClientAccessToken(generated.token));
  assert.notStrictEqual(storedValue, generated.token);

  const queries = [];
  const data = await findClientDataByToken({
    async query(sql, values) {
      queries.push({ sql, values });
      if (queries.length === 1) {
        return {
          rowCount: 1,
          rows: [{
            id: "client-a",
            display_name: "Ada",
            active: true,
            program_id: "program-a",
            program_name: "Strength"
          }]
        };
      }
      return {
        rowCount: 1,
        rows: [{ id: "assignment-a", workout_name: "Strength", exercises: [] }]
      };
    }
  }, generated.token);
  assert.deepStrictEqual(data.client, { displayName: "Ada" });
  assert.deepStrictEqual(data.program, { id: "program-a", name: "Strength" });
  assert.strictEqual(data.assignments[0].id, "assignment-a");
  assert.deepStrictEqual(queries[1].values, ["client-a", "program-a"]);

  const revokeQueries = [];
  const revoked = await revokeClientAccessLink({
    async connect() {
      return {
        async query(sql, values) {
          revokeQueries.push({ sql, values });
          if (sql.includes("SELECT c.id, c.display_name")) {
            return {
              rowCount: 1,
              rows: [{
                id: "client-a",
                display_name: "Ada",
                program_id: "program-a",
                program_name: "Strength"
              }]
            };
          }
          return { rowCount: 1, rows: [{ id: "link-a" }] };
        },
        release() {}
      };
    }
  }, "coach-a", "client-a", "program-a");
  assert.strictEqual(revoked.revoked, true);
  assert.deepStrictEqual(
    revokeQueries.find(query => query.sql.includes("UPDATE public.client_access_links")).values,
    ["client-a", "program-a"]
  );

  const missing = await findClientDataByToken({
    async query() {
      return { rowCount: 0, rows: [] };
    }
  }, "invalid-token");
  assert.strictEqual(missing, null);

  const migration = fs.readFileSync(
    path.join(__dirname, "..", "db", "workoutplanner-migrations", "010_program-bound-client-access-links.sql"),
    "utf8"
  );
  assert.match(migration, /add column program_id uuid/);
  assert.match(migration, /client_access_links_program_client_fkey/);
  assert.match(migration, /client_access_links_one_active_per_program/);

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /app\.post\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.delete\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /function requireWorkoutPlannerOwner\(req, res, next\)[\s\S]*?if \(readAdminSession\(req\)\)[\s\S]*?requireLocalWorkoutPlannerCoach/);
  assert.match(server, /app\.get\('\/api\/client\/:token'/);
  assert.match(server, /app\.get\(\['\/p\/:token'/);
  assert.match(server, /res\.setHeader\('Cache-Control', 'no-store'\)/);
  assert.match(server, /res\.setHeader\('Referrer-Policy', 'no-referrer'\)/);
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