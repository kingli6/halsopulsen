const assert = require("assert");
const fs = require("fs");
const path = require("path");
process.env.SESSION_SECRET = "workoutplanner-link-unit-test-secret";
const {
  findClientDataByToken,
  generateClientAccessToken,
  getClientAccessLink,
  hashClientAccessToken,
  revokeClientAccessLink,
  regenerateClientAccessLink
} = require("../workoutplanner/client-access");
const { listProgramVersions } = require("../workoutplanner/program-library");

async function run() {
  const token = generateClientAccessToken();
  assert.strictEqual(Buffer.from(token, "base64url").length, 32);
  assert.match(hashClientAccessToken(token), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(hashClientAccessToken(token), token);
  assert.strictEqual(
    generateClientAccessToken("link-id-a"),
    generateClientAccessToken("link-id-a")
  );
  assert.notStrictEqual(
    generateClientAccessToken("link-id-a"),
    generateClientAccessToken("link-id-b")
  );

  let historyQuery = "";
  const versions = await listProgramVersions({
    async query(sql, values) {
      historyQuery = sql;
      assert.deepStrictEqual(values, [
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111"
      ]);
      return {
        rows: [
          {
            id: "version-current",
            version_number: 3,
            status: "published",
            created_at: "2026-10-01T10:00:00.000Z",
            published_at: "2026-10-02T10:00:00.000Z"
          },
          {
            id: "version-old",
            version_number: 2,
            status: "archived",
            created_at: "2026-09-20T10:00:00.000Z",
            published_at: "2026-09-21T10:00:00.000Z"
          }
        ]
      };
    }
  }, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  assert.match(historyQuery, /p\.coach_profile_id = \$2/);
  assert.match(historyQuery, /pv\.status in \('published', 'archived'\)/);
  assert.deepStrictEqual(versions.map(version => [version.version, version.status]), [
    [3, "published"],
    [2, "archived"]
  ]);

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
  const linkId = insert.values[0];
  const storedValue = insert.values[3];
  assert.strictEqual(insert.values[1], "client-a");
  assert.strictEqual(insert.values[2], "program-a");
  assert.strictEqual(insert.values[4], "coach-a");
  assert.strictEqual(storedValue, hashClientAccessToken(generated.token));
  assert.notStrictEqual(storedValue, generated.token);

  const recovered = await getClientAccessLink({
    async query(sql, values) {
      assert.deepStrictEqual(values, ["coach-a", "client-a", "program-a"]);
      assert.match(sql, /l\.revoked_at IS NULL/);
      return {
        rowCount: 1,
        rows: [{
          id: linkId,
          token_hash: storedValue,
          client_id: "client-a",
          display_name: "Ada",
          program_id: "program-a",
          program_name: "Strength"
        }]
      };
    }
  }, "coach-a", "client-a", "program-a");
  assert.strictEqual(recovered.recoverable, true);
  assert.strictEqual(recovered.token, generated.token);

  const legacyLink = await getClientAccessLink({
    async query() {
      return {
        rowCount: 1,
        rows: [{
          id: linkId,
          token_hash: hashClientAccessToken("legacy-random-token"),
          client_id: "client-a",
          display_name: "Ada",
          program_id: "program-a",
          program_name: "Strength"
        }]
      };
    }
  }, "coach-a", "client-a", "program-a");
  assert.strictEqual(legacyLink.recoverable, false);
  assert.strictEqual(legacyLink.token, null);

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
  assert.match(server, /app\.get\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.post\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.delete\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.doesNotMatch(server, /app\.post\('\/api\/workoutplanner\/clients',/);
  assert.match(server, /function requireWorkoutPlannerOwner\(req, res, next\)[\s\S]*?if \(readAdminSession\(req\)\)[\s\S]*?requireLocalWorkoutPlannerCoach/);
  assert.match(server, /app\.get\('\/api\/client\/:token'/);
  assert.match(server, /app\.get\(\['\/p\/:token'/);
  assert.match(server, /res\.setHeader\('Cache-Control', 'no-store'\)/);
  assert.match(server, /res\.setHeader\('Referrer-Policy', 'no-referrer'\)/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.js"), "utf8"),
    /api\/plans\/share|method:\s*["'](?:PUT|POST|DELETE)|sessionList|renderSessions/
  );
  const adminPage = fs.readFileSync(path.join(__dirname, "..", "dashboard", "plan", "index.html"), "utf8");
  assert.doesNotMatch(adminPage, /clientCreateForm|clientCreateSection|id="clientList"/);
  assert.doesNotMatch(adminPage, /cloneProgramClientNameInput|cloneProgramNameInput|id="cloneProgramForm"/);
  const planner = fs.readFileSync(path.join(__dirname, "..", "dashboard", "plan.js"), "utf8");
  assert.match(planner, /Use for client/);
  assert.match(planner, /data-copy-client-link/);
  assert.match(planner, /Current private link copied\. It has not been changed\./);
  assert.match(planner, /data-rotate-client-link/);
  assert.match(planner, /data-create-client-copy/);
  assert.match(planner, /data-toggle-program-history/);
  assert.match(planner, /restoreSelectedDatabaseProgramMetadata/);
  const programLibrary = fs.readFileSync(path.join(__dirname, "..", "workoutplanner", "program-library.js"), "utf8");
  const cloneImplementation = programLibrary.slice(
    programLibrary.indexOf("async function cloneLibraryProgramVersion"),
    programLibrary.indexOf("module.exports")
  );
  assert.match(cloneImplementation, /where c\.id = \$1/);
  assert.doesNotMatch(cloneImplementation, /insert into public\.(?:profiles|clients)\s*\(/i);
  assert.doesNotMatch(cloneImplementation, /clientName|clientIdentity/);
  assert.match(server, /req\.body\?\.clientId/);
  assert.doesNotMatch(server, /req\.body\?\.clientName/);
  assert.match(server, /\/api\/workoutplanner\/programs\/:programId\/versions/);

  console.log("WorkoutPlanner private client-link tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});