-- Resolve WorkoutPlanner RLS ownership through the Clerk-backed profile.
-- UUID-based Supabase Auth subjects remain supported for compatibility.

begin;

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with claims as (
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ) as subject
  )
  select p.id
    from public.profiles p
    cross join claims
   where p.id::text = claims.subject
      or p.clerk_user_id = claims.subject
   limit 1;
$$;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select p.role
    from public.profiles p
   where p.id = private.current_profile_id();
$$;

create or replace function private.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select c.id
    from public.clients c
   where c.profile_id = private.current_profile_id();
$$;

create or replace function private.is_coach()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.current_profile_role() = 'coach';
$$;

create or replace function private.coach_can_access_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.is_coach()
    and exists (
      select 1
        from public.coach_clients cc
       where cc.coach_profile_id = private.current_profile_id()
         and cc.client_id = target_client_id
    );
$$;

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
       and p.coach_profile_id = private.current_profile_id()
       and private.is_coach()
  );
$$;

drop policy if exists programs_insert on public.programs;
create policy programs_insert
on public.programs for insert to authenticated
with check (
  private.is_coach()
  and coach_profile_id = private.current_profile_id()
);

drop policy if exists programs_update on public.programs;
create policy programs_update
on public.programs for update to authenticated
using (private.coach_can_access_program(id))
with check (
  private.is_coach()
  and coach_profile_id = private.current_profile_id()
);

drop policy if exists program_versions_insert on public.program_versions;
create policy program_versions_insert
on public.program_versions for insert to authenticated
with check (
  private.coach_can_access_program(program_id)
  and created_by = private.current_profile_id()
);

commit;