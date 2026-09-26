const assert = require("assert");
const crypto = require("crypto");
const { getPool, closePool } = require("../workoutplanner/db");
const {
  findClientDataByToken,
  hashClientAccessToken,
  hasClientAccessToken,
  regenerateClientAccessLink,
  revokeClientAccessLink
} = require("../workoutplanner/client-access");
const {
  cloneLibraryProgramVersion
} = require("../workoutplanner/program-library");

function id() {
  return crypto.randomUUID();
}

async function run() {
  const pool = getPool();
  const fixture = {
    coachId: null,
    otherCoachId: id(),
    clientProfileId: id(),
    clientId: null,
    sourceProgramId: null,
    sourceVersionId: null,
    exerciseId: null,
    programAId: null,
    programBId: null,
    cloneProgramId: null,
    tokenHashes: []
  };

  try {
    const coachResult = await pool.query(
      `select id
         from public.profiles
        where role = 'coach'
        order by created_at
        limit 1`
    );
    assert.strictEqual(coachResult.rowCount, 1, "The real WorkoutPlanner database needs one coach.");
    fixture.coachId = coachResult.rows[0].id;

    await pool.query(
      `insert into public.profiles (id, role, display_name, clerk_user_id)
       values ($1, 'coach', $2, $3)`,
      [fixture.otherCoachId, "Pass 3 test coach", `pass3-test-${fixture.otherCoachId}`]
    );
    await pool.query(
      `insert into public.profiles (id, role, display_name, clerk_user_id)
       values ($1, 'client', $2, null)`,
      [fixture.clientProfileId, "Pass 3 test client"]
    );
    const clientResult = await pool.query(
      `insert into public.clients (profile_id, display_name)
       values ($1, $2)
       returning id`,
      [fixture.clientProfileId, "Pass 3 test client"]
    );
    fixture.clientId = clientResult.rows[0].id;
    await pool.query(
      `insert into public.coach_clients (coach_profile_id, client_id)
       values ($1, $2)`,
      [fixture.coachId, fixture.clientId]
    );

    const sourceProgramResult = await pool.query(
      `insert into public.programs
        (coach_profile_id, client_id, kind, name, description, status)
       values ($1, null, 'library', 'Pass 3 source library', '', 'active')
       returning id`,
      [fixture.coachId]
    );
    fixture.sourceProgramId = sourceProgramResult.rows[0].id;
    const sourceVersionResult = await pool.query(
      `insert into public.program_versions
        (program_id, version_number, status, published_at, created_by)
       values ($1, 1, 'published', now(), $2)
       returning id`,
      [fixture.sourceProgramId, fixture.coachId]
    );
    fixture.sourceVersionId = sourceVersionResult.rows[0].id;
    const sourceWeekResult = await pool.query(
      `insert into public.program_weeks
        (program_version_id, week_number, name)
       values ($1, 1, 'Source week')
       returning id`,
      [fixture.sourceVersionId]
    );
    const sourceWorkoutResult = await pool.query(
      `insert into public.workouts
        (program_week_id, day_of_week, name)
       values ($1, 1, 'Source workout')
       returning id`,
      [sourceWeekResult.rows[0].id]
    );
    const exerciseResult = await pool.query(
      `insert into public.exercises (name)
       values ('Pass 3 exercise')
       returning id`
    );
    fixture.exerciseId = exerciseResult.rows[0].id;
    await pool.query(
      `insert into public.workout_exercises
        (workout_id, exercise_id, sort_order, sets, reps)
       values ($1, $2, 1, 3, 8)`,
      [sourceWorkoutResult.rows[0].id, fixture.exerciseId]
    );

    for (const [name, key] of [["Program A", "programAId"], ["Program B", "programBId"]]) {
      const result = await pool.query(
        `insert into public.programs
          (coach_profile_id, client_id, kind, name, description, status)
         values ($1, $2, 'client', $3, '', 'active')
         returning id`,
        [fixture.coachId, fixture.clientId, name]
      );
      fixture[key] = result.rows[0].id;
    }

    const linkA = await regenerateClientAccessLink(
      pool,
      fixture.coachId,
      fixture.clientId,
      fixture.programAId
    );
    const linkB = await regenerateClientAccessLink(
      pool,
      fixture.coachId,
      fixture.clientId,
      fixture.programBId
    );
    assert.ok(linkA?.token);
    assert.ok(linkB?.token);
    fixture.tokenHashes.push(hashClientAccessToken(linkA.token), hashClientAccessToken(linkB.token));
    assert.strictEqual(Buffer.from(linkA.token, "base64url").length, 32);
    assert.strictEqual(await hasClientAccessToken(pool, linkA.token), true);
    assert.strictEqual(await hasClientAccessToken(pool, linkB.token), true);

    const linkRows = await pool.query(
      `select client_id, program_id, token_hash
         from public.client_access_links
        where token_hash = any($1::text[])`,
      [fixture.tokenHashes]
    );
    assert.strictEqual(linkRows.rowCount, 2);
    assert.deepStrictEqual(
      new Set(linkRows.rows.map(row => row.program_id)),
      new Set([fixture.programAId, fixture.programBId])
    );
    assert.ok(linkRows.rows.every(row => !row.token_hash.includes(linkA.token)));

    let dataA = await findClientDataByToken(pool, linkA.token);
    let dataB = await findClientDataByToken(pool, linkB.token);
    assert.strictEqual(dataA.program.id, fixture.programAId);
    assert.strictEqual(dataB.program.id, fixture.programBId);
    assert.strictEqual(dataA.assignments.length, 0);
    assert.strictEqual(dataB.assignments.length, 0);

    await pool.query(
      `update public.programs
          set name = 'Program A updated'
        where id = $1`,
      [fixture.programAId]
    );
    dataA = await findClientDataByToken(pool, linkA.token);
    dataB = await findClientDataByToken(pool, linkB.token);
    assert.strictEqual(dataA.program.name, "Program A updated");
    assert.strictEqual(dataB.program.name, "Program B");

    const rotatedA = await regenerateClientAccessLink(
      pool,
      fixture.coachId,
      fixture.clientId,
      fixture.programAId
    );
    fixture.tokenHashes.push(hashClientAccessToken(rotatedA.token));
    assert.strictEqual(await hasClientAccessToken(pool, linkA.token), false);
    assert.strictEqual(await hasClientAccessToken(pool, rotatedA.token), true);
    assert.strictEqual(await hasClientAccessToken(pool, linkB.token), true);

    const activePairCounts = await pool.query(
      `select client_id, program_id, count(*)::int as count
         from public.client_access_links
        where client_id = $1
          and revoked_at is null
        group by client_id, program_id`,
      [fixture.clientId]
    );
    assert.deepStrictEqual(
      activePairCounts.rows.map(row => Number(row.count)).sort(),
      [1, 1]
    );

    const revoked = await revokeClientAccessLink(
      pool,
      fixture.coachId,
      fixture.clientId,
      fixture.programAId
    );
    assert.strictEqual(revoked.revoked, true);
    assert.strictEqual(await hasClientAccessToken(pool, rotatedA.token), false);
    assert.strictEqual(await hasClientAccessToken(pool, linkB.token), true);

    assert.strictEqual(
      await regenerateClientAccessLink(
        pool,
        fixture.otherCoachId,
        fixture.clientId,
        fixture.programBId
      ),
      null
    );
    const unauthorizedRevoke = await revokeClientAccessLink(
      pool,
      fixture.otherCoachId,
      fixture.clientId,
      fixture.programBId
    );
    assert.strictEqual(unauthorizedRevoke, null);

    const cloned = await cloneLibraryProgramVersion(
      pool,
      fixture.coachId,
      fixture.sourceProgramId,
      fixture.sourceVersionId,
      fixture.clientId,
      "Cloned client program"
    );
    fixture.cloneProgramId = cloned.id;
    const cloneRow = await pool.query(
      `select kind, client_id, source_program_id, source_version_id
         from public.programs
        where id = $1`,
      [fixture.cloneProgramId]
    );
    assert.deepStrictEqual(cloneRow.rows[0], {
      kind: "client",
      client_id: fixture.clientId,
      source_program_id: fixture.sourceProgramId,
      source_version_id: fixture.sourceVersionId
    });
    const cloneCounts = await pool.query(
      `select
         (select count(*) from public.program_weeks where program_version_id = pv.id) as week_count,
         (select count(*) from public.workouts w join public.program_weeks pw on pw.id = w.program_week_id where pw.program_version_id = pv.id) as workout_count,
         (select count(*) from public.workout_exercises we join public.workouts w on w.id = we.workout_id join public.program_weeks pw on pw.id = w.program_week_id where pw.program_version_id = pv.id) as exercise_count
       from public.program_versions pv
      where pv.program_id = $1`,
      [fixture.cloneProgramId]
    );
    assert.deepStrictEqual(
      cloneCounts.rows[0],
      { week_count: "1", workout_count: "1", exercise_count: "1" }
    );

    await pool.query(
      `update public.program_weeks
          set name = 'Changed source week'
        where id = $1`,
      [sourceWeekResult.rows[0].id]
    );
    const cloneWeek = await pool.query(
      `select pw.name
         from public.program_weeks pw
         join public.program_versions pv on pv.id = pw.program_version_id
        where pv.program_id = $1`,
      [fixture.cloneProgramId]
    );
    assert.strictEqual(cloneWeek.rows[0].name, "Source week");

    assert.strictEqual(await hasClientAccessToken(pool, "not-a-real-token"), false);
    assert.strictEqual(await findClientDataByToken(pool, "not-a-real-token"), null);
    console.log("WorkoutPlanner program-bound client-link checks passed.");
  } finally {
    await pool.query(
      `delete from public.client_access_links
        where client_id = $1`,
      [fixture.clientId]
    ).catch(() => {});
    if (fixture.cloneProgramId) {
      await pool.query(`delete from public.programs where id = $1`, [fixture.cloneProgramId]).catch(() => {});
    }
    for (const programId of [fixture.programAId, fixture.programBId, fixture.sourceProgramId]) {
      if (programId) {
        await pool.query(`delete from public.programs where id = $1`, [programId]).catch(() => {});
      }
    }
    if (fixture.clientId) {
      await pool.query(`delete from public.coach_clients where client_id = $1`, [fixture.clientId]).catch(() => {});
      await pool.query(`delete from public.clients where id = $1`, [fixture.clientId]).catch(() => {});
    }
    await pool.query(`delete from public.profiles where id = $1`, [fixture.clientProfileId]).catch(() => {});
    await pool.query(`delete from public.profiles where id = $1`, [fixture.otherCoachId]).catch(() => {});
    if (fixture.exerciseId) {
      await pool.query(`delete from public.exercises where id = $1`, [fixture.exerciseId]).catch(() => {});
    }
    await closePool();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});