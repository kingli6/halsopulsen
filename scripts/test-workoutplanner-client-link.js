const assert = require("assert");
const fs = require("fs");
const path = require("path");
process.env.SESSION_SECRET = "workoutplanner-link-unit-test-secret";
const {
  findClientDataByToken,
  generateClientAccessToken,
  getClientAccessLink,
  getProgramAccessLink,
  hashClientAccessToken,
  hasClientAccessToken,
  revokeClientAccessLink,
  revokeProgramAccessLink,
  regenerateClientAccessLink,
  regenerateProgramAccessLink
} = require("../workoutplanner/client-access");
const {
  isCompleteProgramForCurrent,
  listProgramVersions
} = require("../workoutplanner/program-library");

async function run() {
  const completeProgram = {
    name: "Current version candidate",
    startDate: "2026-10-12",
    weeks: [{
      weekNumber: 1,
      days: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        enabled: weekday === 1,
        exercises: weekday === 1 ? [{ name: "Squat" }] : []
      }))
    }]
  };
  assert.strictEqual(isCompleteProgramForCurrent(completeProgram), true);
  assert.strictEqual(
    isCompleteProgramForCurrent({ ...completeProgram, startDate: "" }),
    false,
    "A missing start date must leave the save as a draft."
  );
  assert.strictEqual(
    isCompleteProgramForCurrent({
      ...completeProgram,
      weeks: [{ ...completeProgram.weeks[0], days: completeProgram.weeks[0].days.slice(1) }]
    }),
    false,
    "A week with fewer than seven explicit days must leave the save as a draft."
  );
  assert.strictEqual(
    isCompleteProgramForCurrent({
      ...completeProgram,
      weeks: [{
        ...completeProgram.weeks[0],
        days: completeProgram.weeks[0].days.map(day => ({ ...day, enabled: false, exercises: [] }))
      }]
    }),
    false,
    "A program without an active workout must leave the save as a draft."
  );

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
  assert.doesNotMatch(historyQuery, /p\.kind = 'client'/);
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
            client_id: "client-a",
            display_name: "Ada",
            active: true,
            program_id: "program-a",
            program_name: "Strength",
            program_kind: "client"
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

  const directLinkId = "direct-link-a";
  const directToken = generateClientAccessToken(directLinkId);
  const directTokenHash = hashClientAccessToken(directToken);
  const directTransactionQueries = [];
  const directTransactionClient = {
    async query(sql, values) {
      directTransactionQueries.push({ sql, values });
      if (sql.includes("SELECT p.id, p.name, p.person_name")) {
        assert.match(sql, /p\.kind = 'library'/);
        assert.match(sql, /p\.current_version_id IS NOT NULL/i);
        assert.match(sql, /COALESCE\(p\.published_start_date, p\.start_date\) IS NOT NULL/i);
        return {
          rowCount: 1,
          rows: [{ id: "program-a", name: "Strength", person_name: "Ada" }]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const directGenerated = await regenerateProgramAccessLink(
    { async connect() { return directTransactionClient; } },
    "coach-a",
    "program-a"
  );
  assert.ok(directGenerated.token);
  const directInsert = directTransactionQueries.find(query =>
    query.sql.includes("INSERT INTO public.client_access_links")
  );
  assert.match(directInsert.sql, /VALUES \(\$1, NULL, \$2, \$3, \$4\)/);
  assert.strictEqual(directInsert.values[1], "program-a");
  assert.strictEqual(directInsert.values[2], hashClientAccessToken(directGenerated.token));
  assert.strictEqual(directInsert.values[3], "coach-a");

  const directRecovered = await getProgramAccessLink({
    async query(sql, values) {
      assert.deepStrictEqual(values, ["coach-a", "program-a"]);
      assert.match(sql, /l\.client_id IS NULL/);
      assert.match(sql, /p\.current_version_id IS NOT NULL/i);
      assert.match(sql, /COALESCE\(p\.published_start_date, p\.start_date\) IS NOT NULL/i);
      return {
        rowCount: 1,
        rows: [{
          id: directLinkId,
          token_hash: directTokenHash,
          program_id: "program-a",
          program_name: "Strength",
          person_name: "Ada"
        }]
      };
    }
  }, "coach-a", "program-a");
  assert.strictEqual(directRecovered.recoverable, true);
  assert.strictEqual(directRecovered.token, directToken);

  const directQueries = [];
  const directData = await findClientDataByToken({
    async query(sql, values) {
      directQueries.push({ sql, values });
      if (directQueries.length === 1) {
        return {
          rowCount: 1,
          rows: [{
            client_id: null,
            display_name: null,
            active: null,
            program_id: "program-a",
            program_name: "Unpublished draft title",
            program_kind: "library"
          }]
        };
      }
      return {
        rowCount: 1,
        rows: [{
          program_name: "Published program",
          version_number: 4,
          scheduled_date: "2026-10-05",
          day_of_week: 1,
          week_number: 1,
          workout_name: "Published workout",
          exercises: []
        }]
      };
    }
  }, directToken);
  assert.strictEqual(directData.directProgram, true);
  assert.strictEqual(directData.client, null);
  assert.strictEqual(directData.program.name, "Published program");
  assert.strictEqual(directData.program.version, 4);
  assert.strictEqual(directData.assignments[0].program_name, "Published program");
  assert.match(directQueries[1].sql, /COALESCE\(p\.published_start_date, p\.start_date\)/i);
  assert.match(directQueries[1].sql, /candidate\.id = p\.current_version_id/i);
  assert.match(directQueries[1].sql, /candidate\.status = 'published'/i);
  assert.doesNotMatch(directQueries[1].sql, /ORDER BY candidate\.version_number DESC/i);
  assert.match(
    directQueries[1].sql,
    /GROUP BY p\.id, pv\.id, pw\.id, w\.id, pv\.version_number, pv\.published_at/
  );
  assert.doesNotMatch(directQueries[1].sql, /FROM public\.assignments/i);

  let directAccessQuery = "";
  assert.strictEqual(await hasClientAccessToken({
    async query(sql, values) {
      directAccessQuery = sql;
      assert.deepStrictEqual(values, [directTokenHash]);
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }
  }, directToken), true);
  assert.match(directAccessQuery, /l\.client_id IS NULL/);
  assert.match(directAccessQuery, /p\.current_version_id IS NOT NULL/i);
  assert.match(directAccessQuery, /COALESCE\(p\.published_start_date, p\.start_date\) IS NOT NULL/i);

  const directRevokeQueries = [];
  const directRevoked = await revokeProgramAccessLink({
    async connect() {
      return {
        async query(sql, values) {
          directRevokeQueries.push({ sql, values });
          if (sql.includes("SELECT p.id, p.name, p.person_name")) {
            return {
              rowCount: 1,
              rows: [{ id: "program-a", name: "Strength", person_name: "Ada" }]
            };
          }
          if (sql.includes("UPDATE public.client_access_links")) {
            return { rowCount: 1, rows: [{ id: "direct-link-a" }] };
          }
          return { rowCount: 1, rows: [] };
        },
        release() {}
      };
    }
  }, "coach-a", "program-a");
  assert.strictEqual(directRevoked.revoked, true);
  assert.match(
    directRevokeQueries.find(query => query.sql.includes("UPDATE public.client_access_links")).sql,
    /client_id IS NULL/
  );

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
  const directMigration = fs.readFileSync(
    path.join(__dirname, "..", "db", "workoutplanner-migrations", "011_direct-program-publishing.sql"),
    "utf8"
  );
  assert.match(directMigration, /add column person_name text not null default ''/i);
  assert.match(directMigration, /add column published_start_date date/i);
  assert.match(directMigration, /alter column client_id drop not null/i);
  assert.match(directMigration, /client_access_links_one_active_per_direct_program/i);
  assert.match(directMigration, /new\.client_id is distinct from old\.client_id/i);

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /app\.get\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.post\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.delete\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.get\('\/api\/workoutplanner\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.post\('\/api\/workoutplanner\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.delete\('\/api\/workoutplanner\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
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
  assert.doesNotMatch(planner, /Use for client|data-use-for-client|data-client-for-program|data-create-client-copy/);
  assert.match(planner, /data-copy-client-link/);
  assert.match(planner, /Current private link copied\. It has not been changed\./);
  assert.match(planner, /data-rotate-client-link/);
  assert.match(planner, /data-create-program-link/);
  assert.match(planner, /data-rotate-program-link/);
  assert.match(planner, /data-revoke-program-link/);
  assert.match(planner, /data-toggle-program-history/);
  assert.match(planner, /restoreSelectedDatabaseProgramMetadata/);
  const programLibrary = fs.readFileSync(path.join(__dirname, "..", "workoutplanner", "program-library.js"), "utf8");
  const publishImplementation = programLibrary.slice(
    programLibrary.indexOf("async function publishProgram"),
    programLibrary.indexOf("async function cloneLibraryProgramVersion")
  );
  assert.match(publishImplementation, /p\.kind = 'library' and p\.client_id is null/);
  assert.match(publishImplementation, /and p\.client_id is not null/);
   assert.match(publishImplementation, /current_version_id = \$1/);
   assert.match(publishImplementation, /published_start_date = start_date/);
   assert.match(publishImplementation, /revision = revision \+ 1/);
  assert.doesNotMatch(publishImplementation, /client_access_links/i);
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
  const publicPage = fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.js"), "utf8");
  assert.match(publicPage, /Boolean\(result\.data\.directProgram\)/);
  assert.match(publicPage, /Published training plan/);
  assert.match(publicPage, /directProgram && item\.version_number/);
  assert.match(
    fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.html"), "utf8"),
    /href="https:\/\/halsopulsen\.se\/"/
  );

  console.log("WorkoutPlanner private client-link tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});