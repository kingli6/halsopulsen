-- Store prescribed names independently from the global legacy exercise catalog
-- and give each client private exercise identities for performance history.

begin;

alter table public.workout_exercises
  add column exercise_name text;

update public.workout_exercises we
   set exercise_name = e.name
  from public.exercises e
 where e.id = we.exercise_id
   and we.exercise_name is null;

do $$
begin
  if exists (
    select 1
      from public.workout_exercises
     where exercise_name is null or length(btrim(exercise_name)) = 0
  ) then
    raise exception 'Every existing workout prescription must have a name before migration 013';
  end if;
end
$$;

alter table public.workout_exercises
  alter column exercise_name set not null,
  add constraint workout_exercises_exercise_name_not_blank
    check (length(btrim(exercise_name)) > 0),
  alter column exercise_id drop not null;

create table public.client_exercises (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  normalized_name text generated always as (lower(btrim(name))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_exercises_client_name_unique unique (client_id, normalized_name)
);

create trigger client_exercises_set_updated_at
before update on public.client_exercises
for each row execute function private.set_updated_at();

alter table public.session_exercises
  add column client_exercise_id uuid,
  drop constraint session_exercises_prescription_exercise_fkey,
  drop constraint session_exercises_activity_source_check,
  add constraint session_exercises_prescription_fkey
    foreign key (workout_exercise_id)
    references public.workout_exercises (id)
    on delete restrict,
  add constraint session_exercises_client_exercise_fkey
    foreign key (client_exercise_id)
    references public.client_exercises (id)
    on delete restrict,
  add constraint session_exercises_activity_name_not_blank
    check (length(btrim(activity_name)) > 0);

-- Keep any name already captured by a session. For older rows without a
-- snapshot, the linked legacy exercise is the only available name source.
update public.session_exercises se
   set activity_name = coalesce(
     nullif(btrim(se.activity_name), ''),
     (
       select we.exercise_name
         from public.workout_exercises we
        where we.id = se.workout_exercise_id
     ),
     (
       select e.name
         from public.exercises e
        where e.id = se.exercise_id
     )
   )
 where length(btrim(se.activity_name)) = 0;

do $$
begin
  if exists (
    select 1
      from public.session_exercises
     where length(btrim(activity_name)) = 0
  ) then
    raise exception 'Every existing session exercise must retain a name snapshot before migration 013';
  end if;
end
$$;

insert into public.client_exercises (client_id, name)
select distinct ws.client_id, btrim(se.activity_name)
  from public.session_exercises se
  join public.workout_sessions ws on ws.id = se.session_id
 where ws.client_id is not null
   and length(btrim(se.activity_name)) > 0
on conflict (client_id, normalized_name) do nothing;

update public.session_exercises se
   set client_exercise_id = ce.id
  from public.workout_sessions ws,
       public.client_exercises ce
 where ws.id = se.session_id
   and ws.client_id = ce.client_id
   and ce.normalized_name = lower(btrim(se.activity_name))
   and ws.client_id is not null
   and se.client_exercise_id is null;

create index session_exercises_client_exercise_idx
  on public.session_exercises (client_exercise_id);

alter table public.client_exercises enable row level security;

create or replace function private.validate_session_exercise_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_client_id uuid;
  target_assignment_id uuid;
  assigned_workout_id uuid;
  identity_client_id uuid;
begin
  select ws.client_id, ws.assignment_id
    into target_client_id, target_assignment_id
    from public.workout_sessions ws
   where ws.id = new.session_id;

  if not found then
    raise exception 'Session exercise must belong to an existing session';
  end if;

  -- Permit compatibility edits to legacy clientless rows, but never let a
  -- new performance row acquire client-specific identity without a client.
  if target_client_id is null then
    if tg_op = 'UPDATE'
       and old.session_id = new.session_id
       and old.client_exercise_id is null
       and new.client_exercise_id is null then
      return new;
    end if;
    raise exception 'Exercise performance requires a client-scoped session';
  end if;

  if target_assignment_id is null then
    if tg_op = 'UPDATE'
       and old.session_id = new.session_id
       and old.workout_exercise_id is not distinct from new.workout_exercise_id
       and old.client_exercise_id is not distinct from new.client_exercise_id then
      return new;
    end if;
    raise exception 'Exercise performance must be tied to a client program assignment';
  end if;

  select a.workout_id
    into assigned_workout_id
    from public.assignments a
    join public.workouts assigned_workout on assigned_workout.id = a.workout_id
    join public.program_weeks pw on pw.id = assigned_workout.program_week_id
    join public.program_versions pv on pv.id = pw.program_version_id
    join public.programs p on p.id = pv.program_id
   where a.id = target_assignment_id
     and a.client_id = target_client_id
     and p.client_id = target_client_id
     and p.kind = 'client'
     and pv.status in ('published', 'archived');

  if not found then
    raise exception 'Exercise performance assignment does not match the session client and program';
  end if;

  if new.workout_exercise_id is null then
    if tg_op = 'UPDATE'
       and old.workout_exercise_id is null
       and old.client_exercise_id is not distinct from new.client_exercise_id then
      return new;
    end if;
    raise exception 'Exercise performance must reference its exact prescribed exercise';
  end if;

  if not exists (
       select 1
         from public.workout_exercises we
        where we.id = new.workout_exercise_id
          and we.workout_id = assigned_workout_id
     ) then
    raise exception 'Prescribed exercise does not belong to the assigned workout';
  end if;

  select ce.client_id
    into identity_client_id
    from public.client_exercises ce
   where ce.id = new.client_exercise_id;

  if not found or identity_client_id <> target_client_id then
    raise exception 'Exercise identity does not belong to the session client';
  end if;

  if length(btrim(new.activity_name)) = 0 then
    raise exception 'A performed exercise name snapshot is required';
  end if;

  return new;
end
$$;

create trigger session_exercises_validate_scope
before insert or update on public.session_exercises
for each row execute function private.validate_session_exercise_scope();

create or replace function private.validate_session_set_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_client_id uuid;
  target_assignment_id uuid;
  target_client_exercise_id uuid;
begin
  select ws.client_id, ws.assignment_id, se.client_exercise_id
    into target_client_id, target_assignment_id, target_client_exercise_id
    from public.session_exercises se
    join public.workout_sessions ws on ws.id = se.session_id
   where se.id = new.session_exercise_id;

  if not found then
    raise exception 'Performance set must belong to an existing session exercise';
  end if;

  if target_client_id is null then
    if tg_op = 'UPDATE' and old.session_exercise_id = new.session_exercise_id then
      return new;
    end if;
    raise exception 'Exercise performance requires a client-scoped session';
  end if;

  if target_assignment_id is null or target_client_exercise_id is null then
    raise exception 'Exercise performance must have a client identity and program assignment';
  end if;

  return new;
end
$$;

create trigger session_sets_validate_scope
before insert or update on public.session_sets
for each row execute function private.validate_session_set_scope();

revoke all on function private.validate_session_exercise_scope() from public, authenticated;
revoke all on function private.validate_session_set_scope() from public, authenticated;

drop policy session_exercises_insert on public.session_exercises;
create policy session_exercises_insert
on public.session_exercises for insert to authenticated
with check (
  private.client_owns_session(session_id)
  and (
    workout_exercise_id is null
    or private.client_can_read_workout_exercise(workout_exercise_id)
  )
  and exists (
    select 1
      from public.client_exercises ce
      join public.workout_sessions ws on ws.id = session_exercises.session_id
      where ce.id = session_exercises.client_exercise_id
       and ce.client_id = ws.client_id
  )
);

drop policy session_exercises_update on public.session_exercises;
create policy session_exercises_update
on public.session_exercises for update to authenticated
using (private.client_owns_session(session_id))
with check (
  private.client_owns_session(session_id)
  and (
    workout_exercise_id is null
    or private.client_can_read_workout_exercise(workout_exercise_id)
  )
  and exists (
    select 1
      from public.client_exercises ce
      join public.workout_sessions ws on ws.id = session_exercises.session_id
      where ce.id = session_exercises.client_exercise_id
       and ce.client_id = ws.client_id
  )
);

create policy client_exercises_select
on public.client_exercises for select to authenticated
using (
  private.client_can_access_client(client_id)
  or private.coach_can_access_client(client_id)
);

create policy client_exercises_insert
on public.client_exercises for insert to authenticated
with check (
  private.client_can_access_client(client_id)
  or private.coach_can_access_client(client_id)
);

grant select, insert on public.client_exercises to authenticated;

commit;
