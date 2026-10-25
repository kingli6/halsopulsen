const {
  generateClientAccessToken,
  hashClientAccessToken
} = require("./client-access");
const { loadProgram } = require("./program-library");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDate(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function validDuration(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 52;
}

function plannerError(message, statusCode = 400, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

async function getClientPlannerContext(db, tokenHash) {
  if (!/^[a-f0-9]{64}$/i.test(String(tokenHash || ""))) return null;
  const result = await db.query(
    `select l.client_id, l.coach_profile_id, c.display_name
       from public.client_planner_access_links l
       join public.clients c on c.id = l.client_id
       join public.coach_clients cc
         on cc.client_id = l.client_id
        and cc.coach_profile_id = l.coach_profile_id
      where l.token_hash = $1
        and l.revoked_at is null
        and c.active = true
      limit 2`,
    [tokenHash]
  );
  if (result.rowCount !== 1) return null;
  return {
    clientId: result.rows[0].client_id,
    coachProfileId: result.rows[0].coach_profile_id,
    displayName: result.rows[0].display_name
  };
}

async function listClientPlannerPrograms(db, context) {
  const result = await db.query(
    `select p.id, p.name, p.description, p.status, p.revision,
            latest.version_number, latest.version_status,
            placement.planned_start_date, placement.duration_weeks,
            placement.revision as placement_revision
       from public.programs p
       left join public.client_program_placements placement
         on placement.program_id = p.id
        and placement.client_id = p.client_id
       left join lateral (
         select pv.version_number, pv.status as version_status
           from public.program_versions pv
          where pv.program_id = p.id
          order by pv.version_number desc
          limit 1
       ) latest on true
      where p.client_id = $1
        and p.coach_profile_id = $2
        and p.kind = 'client'
        and p.status <> 'archived'
      order by placement.planned_start_date nulls last, p.updated_at desc`,
    [context.clientId, context.coachProfileId]
  );
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description || "",
    status: row.status,
    revision: Number(row.revision) || 0,
    version: Number(row.version_number) || null,
    versionStatus: row.version_status || "draft",
    placement: row.planned_start_date
      ? {
        plannedStartDate: String(row.planned_start_date).slice(0, 10),
        durationWeeks: Number(row.duration_weeks) || 1,
        revision: Number(row.placement_revision) || 0
      }
      : null
  }));
}

async function getClientPlannerProgram(db, context, programId) {
  if (!UUID_PATTERN.test(String(programId || ""))) return null;
  const ownership = await db.query(
    `select p.id, p.revision, placement.planned_start_date,
            placement.duration_weeks, placement.revision as placement_revision
       from public.programs p
       left join public.client_program_placements placement
         on placement.program_id = p.id
        and placement.client_id = p.client_id
      where p.id = $1
        and p.client_id = $2
        and p.coach_profile_id = $3
        and p.kind = 'client'
        and p.status <> 'archived'
      limit 1`,
    [programId, context.clientId, context.coachProfileId]
  );
  if (ownership.rowCount !== 1) return null;
  const loaded = await loadProgram(db, context.coachProfileId, programId);
  if (!loaded) return null;
  return {
    program: loaded.program,
    meta: {
      id: loaded.id,
      revision: loaded.revision,
      version: loaded.version,
      versionStatus: loaded.versionStatus,
      currentVersionId: loaded.currentVersionId
    },
    placement: ownership.rows[0].planned_start_date
      ? {
        plannedStartDate: String(ownership.rows[0].planned_start_date).slice(0, 10),
        durationWeeks: Number(ownership.rows[0].duration_weeks) || 1,
        revision: Number(ownership.rows[0].placement_revision) || 0
      }
      : null
  };
}

async function setClientProgramPlacement(db, context, tokenHash, programId, placement) {
  if (!UUID_PATTERN.test(String(programId || ""))) throw plannerError("That program could not be found.", 404);
  if (!validDate(placement?.plannedStartDate) || !validDuration(placement?.durationWeeks)) {
    throw plannerError("Choose a valid planned start date and a duration between 1 and 52 weeks.");
  }
  const expectedRevision = Number(placement?.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw plannerError("Reload the calendar before changing this program period.");
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    const link = await client.query(
      `select l.id
         from public.client_planner_access_links l
         join public.clients c on c.id = l.client_id
        where l.token_hash = $1
          and l.client_id = $2
          and l.coach_profile_id = $3
          and l.revoked_at is null
          and c.active = true
        for update of l`,
      [tokenHash, context.clientId, context.coachProfileId]
    );
    if (link.rowCount !== 1) throw plannerError("This private planning link is no longer active.", 403);

    const updated = await client.query(
      `update public.client_program_placements placement
          set planned_start_date = $1,
              duration_weeks = $2,
              revision = revision + 1,
              updated_at = now()
         from public.programs p
        where placement.program_id = $3
          and placement.client_id = $4
          and placement.program_id = p.id
          and p.client_id = $4
          and p.coach_profile_id = $5
          and p.kind = 'client'
          and p.status <> 'archived'
          and placement.revision = $6
        returning placement.revision`,
      [
        placement.plannedStartDate,
        Number(placement.durationWeeks),
        programId,
        context.clientId,
        context.coachProfileId,
        expectedRevision
      ]
    );
    if (updated.rowCount !== 1) {
      const error = plannerError(
        "This program period changed in another tab. Reload the calendar and try again.",
        409,
        "STALE_PLACEMENT"
      );
      throw error;
    }
    await client.query("commit");
    return { revision: Number(updated.rows[0].revision) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function archiveClientPlannerProgram(db, context, tokenHash, programId) {
  if (!UUID_PATTERN.test(String(programId || ""))) throw plannerError("That program could not be found.", 404);
  const client = await db.connect();
  try {
    await client.query("begin");
    const link = await client.query(
      `select l.id
         from public.client_planner_access_links l
         join public.clients c on c.id = l.client_id
        where l.token_hash = $1
          and l.client_id = $2
          and l.coach_profile_id = $3
          and l.revoked_at is null
          and c.active = true
        for update of l`,
      [tokenHash, context.clientId, context.coachProfileId]
    );
    if (link.rowCount !== 1) throw plannerError("This private planning link is no longer active.", 403);

    const archived = await client.query(
      `update public.programs
          set status = 'archived',
              revision = revision + 1,
              updated_at = now()
        where id = $1
          and client_id = $2
          and coach_profile_id = $3
          and kind = 'client'
          and status <> 'archived'
        returning id`,
      [programId, context.clientId, context.coachProfileId]
    );
    if (archived.rowCount !== 1) throw plannerError("That program could not be found.", 404);
    await client.query(
      `update public.client_access_links
          set revoked_at = coalesce(revoked_at, now())
        where client_id = $1
          and program_id = $2
          and revoked_at is null`,
      [context.clientId, programId]
    );
    await client.query("delete from public.client_program_placements where program_id = $1 and client_id = $2", [
      programId,
      context.clientId
    ]);
    await client.query("commit");
    return { archived: true };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createClientPlannerLink(db, coachProfileId, clientId) {
  const id = require("crypto").randomUUID();
  const token = generateClientAccessToken(id);
  const tokenHash = hashClientAccessToken(token);
  const client = await db.connect();
  try {
    await client.query("begin");
    const owned = await client.query(
      `select c.id, c.display_name
         from public.clients c
         join public.coach_clients cc on cc.client_id = c.id
        where c.id = $1
          and c.active = true
          and cc.coach_profile_id = $2
        for update of c`,
      [clientId, coachProfileId]
    );
    if (owned.rowCount !== 1) {
      await client.query("rollback");
      return null;
    }
    await client.query(
      `update public.client_planner_access_links
          set revoked_at = coalesce(revoked_at, now())
        where client_id = $1
          and coach_profile_id = $2
          and revoked_at is null`,
      [clientId, coachProfileId]
    );
    await client.query(
      `insert into public.client_planner_access_links
        (id, coach_profile_id, client_id, token_hash)
       values ($1, $2, $3, $4)`,
      [id, coachProfileId, clientId, tokenHash]
    );
    await client.query("commit");
    return { token, client: owned.rows[0] };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getClientPlannerLink(db, coachProfileId, clientId) {
  const result = await db.query(
    `select l.id, l.token_hash, c.id as client_id, c.display_name
       from public.client_planner_access_links l
       join public.clients c on c.id = l.client_id
       join public.coach_clients cc
         on cc.client_id = c.id
        and cc.coach_profile_id = l.coach_profile_id
      where l.coach_profile_id = $1
        and l.client_id = $2
        and l.revoked_at is null
        and c.active = true
      limit 2`,
    [coachProfileId, clientId]
  );
  if (result.rowCount !== 1) return null;
  const row = result.rows[0];
  const token = generateClientAccessToken(row.id);
  return {
    token: hashClientAccessToken(token) === row.token_hash ? token : null,
    client: { id: row.client_id, displayName: row.display_name }
  };
}

async function revokeClientPlannerLink(db, coachProfileId, clientId) {
  const result = await db.query(
    `update public.client_planner_access_links l
        set revoked_at = coalesce(l.revoked_at, now())
       from public.clients c, public.coach_clients cc
      where l.coach_profile_id = $1
        and l.client_id = $2
        and l.revoked_at is null
        and c.id = l.client_id
        and cc.client_id = c.id
        and cc.coach_profile_id = l.coach_profile_id
      returning l.id`,
    [coachProfileId, clientId]
  );
  if (result.rowCount > 1) throw new Error("Multiple active client planning links were found.");
  return { revoked: result.rowCount === 1 };
}

module.exports = {
  archiveClientPlannerProgram,
  createClientPlannerLink,
  getClientPlannerContext,
  getClientPlannerLink,
  getClientPlannerProgram,
  listClientPlannerPrograms,
  revokeClientPlannerLink,
  setClientProgramPlacement
};
