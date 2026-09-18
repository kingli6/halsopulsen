-- WorkoutPlanner Pass 1: coach-owned reusable program library.
-- This keeps client_id for compatibility, but program ownership is explicit.

begin;

alter table public.programs
  add column if not exists coach_profile_id uuid;

alter table public.programs
  add column if not exists start_date date;

alter table public.programs
  add constraint programs_coach_profile_id_fkey
  foreign key (coach_profile_id)
  references public.profiles(id)
  on delete restrict;

-- Existing client-owned programs can be assigned to their unique coach when
-- possible. Ambiguous ownership is left untouched and causes the migration to
-- stop rather than silently assigning ownership or deleting data.
update public.programs p
   set coach_profile_id = owners.coach_profile_id
  from (
    select client_id, (array_agg(coach_profile_id order by coach_profile_id))[1] as coach_profile_id
      from public.coach_clients
     group by client_id
    having count(*) = 1
  ) owners
 where p.client_id = owners.client_id
   and p.coach_profile_id is null;

do $$
begin
  if exists (
    select 1
      from public.programs
     where coach_profile_id is null
  ) then
    raise exception
      'Cannot assign ownership to every existing program; resolve coach_clients relationships first';
  end if;
end $$;

alter table public.programs
  alter column coach_profile_id set not null;

alter table public.programs
  alter column client_id drop not null;

alter table public.program_weeks
  add column if not exists phase text not null default '',
  add column if not exists progression_notes text not null default '',
  add column if not exists success_metric text not null default '';

-- These are planner-specific fields that do not have equivalent normalized
-- columns in the initial foundation. The common prescription values remain in
-- their typed columns; this metadata preserves the remaining editor semantics
-- without duplicating sets/reps/duration/load columns.
alter table public.workout_exercises
  add column if not exists planner_metadata jsonb not null default '{}'::jsonb;

create index if not exists programs_coach_status_idx
  on public.programs (coach_profile_id, status, updated_at desc);

create or replace function private.coach_can_access_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
      from public.programs p
     where p.id = target_program_id
       and p.coach_profile_id = auth.uid()
       and private.is_coach()
  );
$$;

drop policy if exists programs_insert on public.programs;
create policy programs_insert
on public.programs for insert to authenticated
with check (
  private.is_coach()
  and coach_profile_id = auth.uid()
);

drop policy if exists programs_update on public.programs;
create policy programs_update
on public.programs for update to authenticated
using (private.coach_can_access_program(id))
with check (
  private.is_coach()
  and coach_profile_id = auth.uid()
);

drop policy if exists programs_delete on public.programs;
create policy programs_delete
on public.programs for delete to authenticated
using (private.coach_can_access_program(id));

drop policy if exists program_versions_insert on public.program_versions;
create policy program_versions_insert
on public.program_versions for insert to authenticated
with check (
  private.coach_can_access_program(program_id)
  and created_by = auth.uid()
);

commit;