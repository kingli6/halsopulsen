-- WorkoutPlanner Step 1: current program pointers and minimal session support.
-- Runtime save and session behavior are implemented in later steps.

begin;

-- A historical performance date cannot be inferred from created_at without
-- inventing data. This disposable development database must be reset first if
-- the old, not-yet-wired session tables contain rows.
do $$
begin
  if exists (select 1 from public.workout_sessions) then
    raise exception
      'Reset the disposable WorkoutPlanner development database before migration 012; existing sessions have no trustworthy performance date';
  end if;
end
$$;

-- The pointer is the source of truth for the current version. Keep the
-- existing status column for version history and current runtime compatibility.
alter table public.program_versions
  add constraint program_versions_program_id_id_unique
  unique (program_id, id);

alter table public.programs
  add column current_version_id uuid,
  add column revision bigint not null default 0,
  add constraint programs_revision_nonnegative
    check (revision >= 0);

-- Existing saved versions become the program's current/history snapshots.
-- The highest version number is the most recently saved editor state.
with ranked_versions as (
  select
    id,
    program_id,
    row_number() over (
      partition by program_id
      order by version_number desc
    ) as version_rank
  from public.program_versions
)
update public.program_versions pv
   set status = case
     when ranked.version_rank = 1 then 'published'
     else 'archived'
   end
  from ranked_versions ranked
 where ranked.id = pv.id;

update public.programs p
   set current_version_id = (
     select pv.id
       from public.program_versions pv
      where pv.program_id = p.id
      order by pv.version_number desc
      limit 1
   )
 where exists (
   select 1
     from public.program_versions pv
    where pv.program_id = p.id
 );

alter table public.programs
  add constraint programs_current_version_fkey
  foreign key (id, current_version_id)
  references public.program_versions (program_id, id)
  deferrable initially deferred;

-- Retain the existing status labels for history consumers, but prevent two
-- versions for one program from both being marked current/published.
create unique index program_versions_one_published_per_program_idx
  on public.program_versions (program_id)
  where status = 'published';

-- Published versions may only be archived; archived versions cannot be
-- changed or deleted. New versions are assembled as drafts within a single
-- transaction, then made current.
create or replace function private.protect_program_version_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Program versions must be created as drafts';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Current and historical program versions cannot be deleted';
    end if;
    return old;
  end if;

  if old.status = 'draft' and new.status in ('draft', 'published') then
    return new;
  end if;

  if old.status = 'published'
     and new.status = 'archived'
     and (to_jsonb(new) - 'status') is not distinct from (to_jsonb(old) - 'status') then
    return new;
  end if;

  raise exception 'Current and historical program versions are immutable';
end
$$;

create trigger program_versions_protect_lifecycle
before insert or update or delete on public.program_versions
for each row execute function private.protect_program_version_lifecycle();

-- Content may be assembled only while its version is a draft. These checks
-- intentionally do not take ancestor locks or perform race-retry machinery;
-- the save transaction and revision check are handled by the later runtime step.
create or replace function private.protect_program_version_content()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  old_version_id uuid;
  new_version_id uuid;
  version_id uuid;
  version_status text;
begin
  if tg_table_name = 'program_weeks' then
    if tg_op <> 'INSERT' then
      old_version_id := old.program_version_id;
    end if;
    if tg_op <> 'DELETE' then
      new_version_id := new.program_version_id;
    end if;
  elsif tg_table_name = 'workouts' then
    if tg_op <> 'INSERT' then
      select pw.program_version_id
        into old_version_id
        from public.program_weeks pw
       where pw.id = old.program_week_id;
    end if;
    if tg_op <> 'DELETE' then
      select pw.program_version_id
        into new_version_id
        from public.program_weeks pw
       where pw.id = new.program_week_id;
    end if;
  elsif tg_table_name = 'workout_exercises' then
    if tg_op <> 'INSERT' then
      select pw.program_version_id
        into old_version_id
        from public.workouts w
        join public.program_weeks pw on pw.id = w.program_week_id
       where w.id = old.workout_id;
    end if;
    if tg_op <> 'DELETE' then
      select pw.program_version_id
        into new_version_id
        from public.workouts w
        join public.program_weeks pw on pw.id = w.program_week_id
       where w.id = new.workout_id;
    end if;
  else
    raise exception 'Unsupported program content table: %', tg_table_name;
  end if;

  foreach version_id in array array[old_version_id, new_version_id] loop
    if version_id is null then
      continue;
    end if;

    select pv.status
      into version_status
      from public.program_versions pv
     where pv.id = version_id;

    -- A missing parent can occur only while a draft version is being removed
    -- through its declared cascading foreign keys.
    if not found then
      if tg_op = 'DELETE' then
        continue;
      end if;
      raise exception 'Program content must belong to an existing version';
    end if;

    if version_status <> 'draft' then
      raise exception 'Published program version content is immutable';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger program_weeks_protect_version_content
before insert or update or delete on public.program_weeks
for each row execute function private.protect_program_version_content();

create trigger workouts_protect_version_content
before insert or update or delete on public.workouts
for each row execute function private.protect_program_version_content();

create trigger workout_exercises_protect_version_content
before insert or update or delete on public.workout_exercises
for each row execute function private.protect_program_version_content();

revoke all on function private.protect_program_version_lifecycle() from public, authenticated;
revoke all on function private.protect_program_version_content() from public, authenticated;

-- Planned sessions point to their exact version-specific workout. Unplanned
-- sessions point directly to the program. Client accounts remain optional.
alter table public.workout_sessions
  alter column client_id drop not null,
  add column program_id uuid,
  add column workout_id uuid,
  add column performed_on date not null,
  drop constraint workout_sessions_status_check,
  alter column status drop default,
  add constraint workout_sessions_status_check
    check (status in ('completed', 'skipped')),
  add constraint workout_sessions_program_id_fkey
    foreign key (program_id)
    references public.programs (id)
    on delete restrict,
  add constraint workout_sessions_workout_id_fkey
    foreign key (workout_id)
    references public.workouts (id)
    on delete restrict,
  add constraint workout_sessions_program_association_check
    check (
      program_id is null
      or (workout_id is null and assignment_id is null)
    ),
  add constraint workout_sessions_source_check
    check (
      program_id is not null
      or workout_id is not null
      or assignment_id is not null
    );

create index workout_sessions_program_performed_idx
  on public.workout_sessions (program_id, performed_on desc);

create index workout_sessions_workout_id_idx
  on public.workout_sessions (workout_id);

-- Keep stable exercise identity while allowing free-text activities. A
-- prescription reference must match the stable exercise ID it names.
alter table public.workout_exercises
  add constraint workout_exercises_id_exercise_unique
  unique (id, exercise_id);

alter table public.session_exercises
  alter column exercise_id drop not null,
  add column activity_name text not null default '',
  drop constraint if exists session_exercises_workout_exercise_id_fkey,
  add constraint session_exercises_prescription_exercise_fkey
    foreign key (workout_exercise_id, exercise_id)
    references public.workout_exercises (id, exercise_id)
    on delete restrict,
  add constraint session_exercises_activity_source_check
    check (
      (workout_exercise_id is null or exercise_id is not null)
      and (
        exercise_id is not null
        or length(btrim(activity_name)) > 0
      )
    );

commit;
