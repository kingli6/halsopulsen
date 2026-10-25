-- Client planning workspace: access is scoped to one coach/client relationship,
-- while calendar placement is independent of versioned program prescriptions.

begin;

create table public.client_planner_access_links (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null,
  client_id uuid not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint client_planner_access_links_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint client_planner_access_links_coach_client_fkey
    foreign key (coach_profile_id, client_id)
    references public.coach_clients (coach_profile_id, client_id)
    on delete cascade
);

create unique index client_planner_access_links_token_hash_unique
  on public.client_planner_access_links (token_hash);

create unique index client_planner_access_links_one_active_per_relationship
  on public.client_planner_access_links (coach_profile_id, client_id)
  where revoked_at is null;

create table public.client_program_placements (
  program_id uuid primary key,
  client_id uuid not null,
  planned_start_date date,
  duration_weeks integer not null default 1
    check (duration_weeks between 1 and 52),
  revision integer not null default 0
    check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_program_placements_program_client_fkey
    foreign key (program_id, client_id)
    references public.programs (id, client_id)
    on delete cascade
);

create index client_program_placements_client_start_idx
  on public.client_program_placements (client_id, planned_start_date, program_id);

-- Preserve existing client program dates as initial placements. Programs with
-- no legacy calendar anchor remain unscheduled rather than receiving invented dates.
insert into public.client_program_placements
  (program_id, client_id, planned_start_date, duration_weeks)
select p.id,
       p.client_id,
       coalesce(p.published_start_date, p.start_date),
       least(52, greatest(1, coalesce(weeks.last_week_number, 1)))
  from public.programs p
  left join lateral (
    select max(pw.week_number)::integer as last_week_number
      from public.program_weeks pw
     where pw.program_version_id = coalesce(
       p.current_version_id,
       (
         select pv.id
           from public.program_versions pv
          where pv.program_id = p.id
          order by pv.version_number desc
          limit 1
       )
     )
  ) weeks on true
 where p.kind = 'client'
   and p.client_id is not null
   and p.status <> 'archived'
on conflict (program_id) do nothing;

alter table public.client_planner_access_links enable row level security;
alter table public.client_program_placements enable row level security;

create policy client_planner_access_links_coach_select
on public.client_planner_access_links for select to authenticated
using (
  coach_profile_id = private.current_profile_id()
  and private.current_profile_role() = 'coach'
);

create policy client_planner_access_links_coach_insert
on public.client_planner_access_links for insert to authenticated
with check (
  coach_profile_id = private.current_profile_id()
  and private.current_profile_role() = 'coach'
  and exists (
    select 1 from public.coach_clients cc
     where cc.coach_profile_id = client_planner_access_links.coach_profile_id
       and cc.client_id = client_planner_access_links.client_id
  )
);

create policy client_planner_access_links_coach_update
on public.client_planner_access_links for update to authenticated
using (
  coach_profile_id = private.current_profile_id()
  and private.current_profile_role() = 'coach'
)
with check (coach_profile_id = private.current_profile_id());

create policy client_program_placements_coach_select
on public.client_program_placements for select to authenticated
using (
  exists (
    select 1
      from public.programs p
     where p.id = client_program_placements.program_id
       and p.client_id = client_program_placements.client_id
       and p.coach_profile_id = private.current_profile_id()
  )
);

create policy client_program_placements_coach_insert
on public.client_program_placements for insert to authenticated
with check (
  exists (
    select 1
      from public.programs p
     where p.id = client_program_placements.program_id
       and p.client_id = client_program_placements.client_id
       and p.coach_profile_id = private.current_profile_id()
  )
);

create policy client_program_placements_coach_update
on public.client_program_placements for update to authenticated
using (
  exists (
    select 1
      from public.programs p
     where p.id = client_program_placements.program_id
       and p.client_id = client_program_placements.client_id
       and p.coach_profile_id = private.current_profile_id()
  )
)
with check (
  exists (
    select 1
      from public.programs p
     where p.id = client_program_placements.program_id
       and p.client_id = client_program_placements.client_id
       and p.coach_profile_id = private.current_profile_id()
  )
);

create policy client_program_placements_coach_delete
on public.client_program_placements for delete to authenticated
using (
  exists (
    select 1
      from public.programs p
      where p.id = client_program_placements.program_id
        and p.client_id = client_program_placements.client_id
       and p.coach_profile_id = private.current_profile_id()
  )
);

commit;
