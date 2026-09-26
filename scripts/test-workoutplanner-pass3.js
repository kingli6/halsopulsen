const assert = require("assert");
const { getPool, closePool } = require("../workoutplanner/db");
const {
  findClientDataByToken,
  hashClientAccessToken,
  hasClientAccessToken,
  regenerateClientAccessLink,
  revokeClientAccessLink
} = require("../workoutplanner/client-access");

async function run() {
  const pool = getPool();
  const createdTokenHashes = [];
  let clientIds = [];
  let coachId;

  try {
    const fixtureResult = await pool.query(`
      SELECT
        coach.id AS coach_id,
        client.id AS client_id,
        client.display_name
      FROM public.profiles coach
      JOIN public.coach_clients relationship
        ON relationship.coach_profile_id = coach.id
      JOIN public.clients client
        ON client.id = relationship.client_id
      WHERE coach.role = 'coach'
        AND client.active = true
      ORDER BY client.created_at ASC
      LIMIT 2
    `);
    assert.strictEqual(
      fixtureResult.rowCount,
      2,
      "The real WorkoutPlanner database needs one coach with two active clients."
    );

    coachId = fixtureResult.rows[0].coach_id;
    clientIds = fixtureResult.rows.map(row => row.client_id);
    const firstClient = fixtureResult.rows[0];
    const secondClient = fixtureResult.rows[1];

    const firstLink = await regenerateClientAccessLink(pool, coachId, firstClient.client_id);
    assert.ok(firstLink?.token);
    createdTokenHashes.push(hashClientAccessToken(firstLink.token));
    assert.strictEqual(Buffer.from(firstLink.token, "base64url").length, 32);
    assert.strictEqual(await hasClientAccessToken(pool, firstLink.token), true);

    const storedFirstLink = await pool.query(
      `SELECT token_hash, revoked_at
         FROM public.client_access_links
        WHERE token_hash = $1`,
      [createdTokenHashes[0]]
    );
    assert.strictEqual(storedFirstLink.rowCount, 1);
    assert.strictEqual(storedFirstLink.rows[0].token_hash, createdTokenHashes[0]);
    assert.strictEqual(storedFirstLink.rows[0].revoked_at, null);
    assert.doesNotMatch(
      storedFirstLink.rows[0].token_hash,
      new RegExp(firstLink.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );

    const firstData = await findClientDataByToken(pool, firstLink.token);
    assert.strictEqual(firstData.client.displayName, firstClient.display_name);
    assert.ok(Array.isArray(firstData.assignments));
    assert.strictEqual("sessions" in firstData, false);

    const secondLink = await regenerateClientAccessLink(pool, coachId, secondClient.client_id);
    assert.ok(secondLink?.token);
    createdTokenHashes.push(hashClientAccessToken(secondLink.token));
    const secondData = await findClientDataByToken(pool, secondLink.token);
    assert.strictEqual(secondData.client.displayName, secondClient.display_name);
    assert.notStrictEqual(firstData.client.displayName, secondData.client.displayName);

    const rotatedLink = await regenerateClientAccessLink(pool, coachId, firstClient.client_id);
    assert.ok(rotatedLink?.token);
    createdTokenHashes.push(hashClientAccessToken(rotatedLink.token));
    assert.strictEqual(await hasClientAccessToken(pool, firstLink.token), false);
    assert.strictEqual(await hasClientAccessToken(pool, rotatedLink.token), true);
    const activeLinkCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM public.client_access_links
        WHERE client_id = $1
          AND revoked_at IS NULL`,
      [firstClient.client_id]
    );
    assert.strictEqual(activeLinkCount.rows[0].count, 1);

    const revoked = await revokeClientAccessLink(pool, coachId, firstClient.client_id);
    assert.strictEqual(revoked.revoked, true);
    assert.strictEqual(await hasClientAccessToken(pool, rotatedLink.token), false);
    assert.strictEqual(await hasClientAccessToken(pool, secondLink.token), true);

    const unauthorizedCoach = await pool.query(
      `SELECT p.id
         FROM public.profiles p
        WHERE p.role = 'coach'
          AND p.id <> $1
        LIMIT 1`,
      [coachId]
    );
    if (unauthorizedCoach.rowCount > 0) {
      assert.strictEqual(
        await regenerateClientAccessLink(pool, unauthorizedCoach.rows[0].id, secondClient.client_id),
        null
      );
      assert.strictEqual(
        await revokeClientAccessLink(pool, unauthorizedCoach.rows[0].id, secondClient.client_id),
        null
      );
    }

    assert.strictEqual(await hasClientAccessToken(pool, "not-a-real-token"), false);
    assert.strictEqual(await findClientDataByToken(pool, "not-a-real-token"), null);
    console.log("WorkoutPlanner Pass 3 PostgreSQL checks passed.");
  } finally {
    if (createdTokenHashes.length > 0) {
      await pool.query(
        `DELETE FROM public.client_access_links
          WHERE token_hash = ANY($1::text[])`,
        [createdTokenHashes]
      ).catch(error => {
        console.error(`WorkoutPlanner Pass 3 cleanup failed: ${error.message}`);
        throw error;
      });
    }
    await closePool();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});