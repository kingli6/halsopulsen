-- WorkoutPlanner Supabase foundation.
-- This migration is intentionally separate from db/supabase-migrations,
-- which belongs to the existing Booking Supabase project.
--
-- Statuses use constrained text instead of PostgreSQL enum types. This keeps
-- the initial schema easy to evolve as product states become clearer without
-- requiring enum alteration migrations.

begin;

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client'
    check (role in ('coach', 'client')),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  display_name text not null,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_display_name_not_blank check (length(btrim(display_name)) > 0)
);

create table if not exists public.coach_clients (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint coach_clients_unique_relationship unique (coach_profile_id, client_id)
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text not null default 'other',
  default_resource_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercises_name_not_blank check (length(btrim(name)) > 0),
  constraint exercises_category_not_blank check (length(btrim(category)) > 0)
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programs_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.program_versions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  constraint program_versions_unique_number unique (program_id, version_number)
);

create table if not exists public.program_weeks (
  id uuid primary key default gen_random_uuid(),
  program_version_id uuid not null references public.program_versions(id) on delete cascade,
  week_number integer not null check (week_number > 0),
  name text not null default '',
  constraint program_weeks_unique_number unique (program_version_id, week_number)
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  program_week_id uuid not null references public.program_weeks(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 1 and 7),
  name text not null default '',
  description text not null default '',
  session_type text not null default 'other',
  warmup text not null default '',
  cooldown text not null default '',
  is_rest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workouts_unique_weekday unique (program_week_id, day_of_week)
);

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  sort_order integer not null check (sort_order > 0),
  sets integer check (sets is null or sets > 0),
  reps integer check (reps is null or reps >= 0),
  duration numeric(12, 3) check (duration is null or duration >= 0),
  duration_unit text,
  distance numeric(12, 3) check (distance is null or distance >= 0),
  distance_unit text,
  load numeric(12, 3) check (load is null or load >= 0),
  load_unit text,
  rir integer check (rir is null or rir >= 0),
  tempo text,
  rest_seconds integer check (rest_seconds is null or rest_seconds >= 0),
  intensity numeric(8, 2) check (intensity is null or intensity >= 0),
  intensity_unit text,
  work_seconds integer check (work_seconds is null or work_seconds >= 0),
  recovery_seconds integer check (recovery_seconds is null or recovery_seconds >= 0),
  rounds integer check (rounds is null or rounds > 0),
  notes text not null default '',
  resource_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_exercises_unique_order unique (workout_id, sort_order)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete restrict,
  recommended_date date not null,
  scheduled_date date not null,
  status text not null default 'planned'
    check (status in ('planned', 'moved', 'completed', 'skipped', 'missed', 'excused')),
  moved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.assignments(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'recorded'
    check (status in ('in_progress', 'recorded', 'partial', 'completed', 'cancelled')),
  difficulty integer check (difficulty is null or difficulty between 1 and 10),
  energy integer check (energy is null or energy between 1 and 5),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  workout_exercise_id uuid references public.workout_exercises(id) on delete restrict,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  sort_order integer not null check (sort_order > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_exercises_unique_order unique (session_id, sort_order)
);

create table if not exists public.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  reps integer check (reps is null or reps >= 0),
  duration numeric(12, 3) check (duration is null or duration >= 0),
  duration_unit text,
  distance numeric(12, 3) check (distance is null or distance >= 0),
  distance_unit text,
  load numeric(12, 3) check (load is null or load >= 0),
  load_unit text,
  rir integer check (rir is null or rir >= 0),
  intensity numeric(8, 2) check (intensity is null or intensity >= 0),
  intensity_unit text,
  completed boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_sets_unique_number unique (session_exercise_id, set_number)
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function private.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.id
  from public.clients c
  where c.profile_id = auth.uid();
$$;

create or replace function private.is_coach()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'coach'
  );
$$;

create or replace function private.profile_is_client(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = target_profile_id
      and p.role = 'client'
  );
$$;

create or replace function private.client_profile_is_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.clients c
    join public.profiles p on p.id = c.profile_id
    where c.id = target_client_id
      and p.role = 'client'
  );
$$;

create or replace function private.coach_can_access_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.is_coach()
    and exists (
      select 1
      from public.coach_clients cc
      where cc.coach_profile_id = auth.uid()
        and cc.client_id = target_client_id
    );
$$;

create or replace function private.client_can_access_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.current_client_id() = target_client_id;
$$;

create or replace function private.can_access_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.client_can_access_client(target_client_id)
      or private.coach_can_access_client(target_client_id);
$$;

create or replace function private.coach_can_access_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.clients c
    where c.profile_id = target_profile_id
      and private.coach_can_access_client(c.id)
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
      and private.coach_can_access_client(p.client_id)
  );
$$;

create or replace function private.client_can_access_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.programs p
    join public.program_versions pv on pv.program_id = p.id
    where p.id = target_program_id
      and private.client_can_access_client(p.client_id)
      and pv.status in ('published', 'archived')
  );
$$;

create or replace function private.coach_can_access_program_version(target_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.program_versions pv
    where pv.id = target_version_id
      and private.coach_can_access_program(pv.program_id)
  );
$$;

create or replace function private.client_can_access_program_version(target_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.program_versions pv
    join public.programs p on p.id = pv.program_id
    where pv.id = target_version_id
      and pv.status in ('published', 'archived')
      and private.client_can_access_client(p.client_id)
  );
$$;

create or replace function private.can_read_program_version(target_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.coach_can_access_program_version(target_version_id)
      or private.client_can_access_program_version(target_version_id);
$$;

create or replace function private.coach_can_access_week(target_week_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.program_weeks pw
    where pw.id = target_week_id
      and private.coach_can_access_program_version(pw.program_version_id)
  );
$$;

create or replace function private.client_can_access_week(target_week_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.program_weeks pw
    where pw.id = target_week_id
      and private.client_can_access_program_version(pw.program_version_id)
  );
$$;

create or replace function private.coach_can_access_workout(target_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.workouts w
    where w.id = target_workout_id
      and private.coach_can_access_week(w.program_week_id)
  );
$$;

create or replace function private.client_can_access_workout(target_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.workouts w
    where w.id = target_workout_id
      and private.client_can_access_week(w.program_week_id)
  );
$$;

create or replace function private.client_can_read_workout_exercise(target_workout_exercise_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.workout_exercises we
    join public.assignments a on a.workout_id = we.workout_id
    join public.workouts w on w.id = we.workout_id
    join public.program_weeks pw on pw.id = w.program_week_id
    join public.program_versions pv on pv.id = pw.program_version_id
    where we.id = target_workout_exercise_id
      and a.client_id = private.current_client_id()
      and pv.status in ('published', 'archived')
  );
$$;

create or replace function private.client_can_read_exercise(target_exercise_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.workout_exercises we
    join public.assignments a on a.workout_id = we.workout_id
    join public.workouts w on w.id = we.workout_id
    join public.program_weeks pw on pw.id = w.program_week_id
    join public.program_versions pv on pv.id = pw.program_version_id
    where we.exercise_id = target_exercise_id
      and a.client_id = private.current_client_id()
      and pv.status in ('published', 'archived')
  );
$$;

create or replace function private.client_can_read_assignment(target_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.assignments a
    join public.workouts w on w.id = a.workout_id
    join public.program_weeks pw on pw.id = w.program_week_id
    join public.program_versions pv on pv.id = pw.program_version_id
    where a.id = target_assignment_id
      and a.client_id = private.current_client_id()
      and pv.status in ('published', 'archived')
  );
$$;

create or replace function private.can_access_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.workout_sessions ws
    where ws.id = target_session_id
      and (
        private.client_can_access_client(ws.client_id)
        or private.coach_can_access_client(ws.client_id)
      )
  );
$$;

create or replace function private.client_owns_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.workout_sessions ws
    where ws.id = target_session_id
      and ws.client_id = private.current_client_id()
  );
$$;

create or replace function private.client_owns_session_exercise(target_session_exercise_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.session_exercises se
    join public.workout_sessions ws on ws.id = se.session_id
    where se.id = target_session_exercise_id
      and ws.client_id = private.current_client_id()
  );
$$;

create or replace function private.can_access_session_exercise(target_session_exercise_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.session_exercises se
    join public.workout_sessions ws on ws.id = se.session_id
    where se.id = target_session_exercise_id
      and (
        private.client_can_access_client(ws.client_id)
        or private.coach_can_access_client(ws.client_id)
      )
  );
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger clients_set_updated_at
before update on public.clients
for each row execute function private.set_updated_at();

create trigger exercises_set_updated_at
before update on public.exercises
for each row execute function private.set_updated_at();

create trigger programs_set_updated_at
before update on public.programs
for each row execute function private.set_updated_at();

create trigger workouts_set_updated_at
before update on public.workouts
for each row execute function private.set_updated_at();

create trigger workout_exercises_set_updated_at
before update on public.workout_exercises
for each row execute function private.set_updated_at();

create trigger assignments_set_updated_at
before update on public.assignments
for each row execute function private.set_updated_at();

create trigger workout_sessions_set_updated_at
before update on public.workout_sessions
for each row execute function private.set_updated_at();

create trigger session_exercises_set_updated_at
before update on public.session_exercises
for each row execute function private.set_updated_at();

create trigger session_sets_set_updated_at
before update on public.session_sets
for each row execute function private.set_updated_at();

create index if not exists profiles_role_idx
  on public.profiles (role);
create index if not exists clients_active_idx
  on public.clients (active, display_name);
create index if not exists coach_clients_client_idx
  on public.coach_clients (client_id);
create index if not exists exercises_active_category_idx
  on public.exercises (active, category, name);
create index if not exists programs_client_status_idx
  on public.programs (client_id, status, updated_at desc);
create index if not exists program_versions_program_status_idx
  on public.program_versions (program_id, status, version_number desc);
create index if not exists program_weeks_version_idx
  on public.program_weeks (program_version_id, week_number);
create index if not exists workouts_week_day_idx
  on public.workouts (program_week_id, day_of_week);
create index if not exists workout_exercises_exercise_idx
  on public.workout_exercises (exercise_id);
create index if not exists assignments_client_date_idx
  on public.assignments (client_id, scheduled_date, status);
create index if not exists assignments_workout_idx
  on public.assignments (workout_id);
create index if not exists workout_sessions_client_created_idx
  on public.workout_sessions (client_id, created_at desc);
create index if not exists workout_sessions_assignment_idx
  on public.workout_sessions (assignment_id);
create index if not exists session_exercises_session_idx
  on public.session_exercises (session_id, sort_order);
create index if not exists session_exercises_workout_exercise_idx
  on public.session_exercises (workout_exercise_id);
create index if not exists session_sets_exercise_idx
  on public.session_sets (session_exercise_id, set_number);

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.coach_clients enable row level security;
alter table public.exercises enable row level security;
alter table public.programs enable row level security;
alter table public.program_versions enable row level security;
alter table public.program_weeks enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.assignments enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.session_sets enable row level security;

create policy profiles_select
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or private.coach_can_access_profile(id)
);

create policy profiles_insert
on public.profiles for insert to authenticated
with check (
  id = auth.uid()
  and role = 'client'
);

create policy profiles_update
on public.profiles for update to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role = private.current_profile_role()
);

create policy clients_select
on public.clients for select to authenticated
using (private.can_access_client(id));

create policy clients_insert
on public.clients for insert to authenticated
with check (
  private.is_coach()
  and private.profile_is_client(profile_id)
);

create policy clients_update
on public.clients for update to authenticated
using (private.coach_can_access_client(id))
with check (private.coach_can_access_client(id));

create policy clients_delete
on public.clients for delete to authenticated
using (private.coach_can_access_client(id));

create policy coach_clients_select
on public.coach_clients for select to authenticated
using (
  (coach_profile_id = auth.uid() and private.is_coach())
  or private.client_can_access_client(client_id)
);

create policy coach_clients_insert
on public.coach_clients for insert to authenticated
with check (
  coach_profile_id = auth.uid()
  and private.is_coach()
  and private.client_profile_is_client(client_id)
);

create policy coach_clients_delete
on public.coach_clients for delete to authenticated
using (coach_profile_id = auth.uid() and private.is_coach());

create policy exercises_select
on public.exercises for select to authenticated
using (
  private.is_coach()
  or private.client_can_read_exercise(id)
);

create policy exercises_insert
on public.exercises for insert to authenticated
with check (private.is_coach());

create policy exercises_update
on public.exercises for update to authenticated
using (private.is_coach())
with check (private.is_coach());

create policy exercises_delete
on public.exercises for delete to authenticated
using (private.is_coach());

create policy programs_select
on public.programs for select to authenticated
using (
  private.coach_can_access_client(client_id)
  or private.client_can_access_program(id)
);

create policy programs_insert
on public.programs for insert to authenticated
with check (private.coach_can_access_client(client_id));

create policy programs_update
on public.programs for update to authenticated
using (private.coach_can_access_client(client_id))
with check (private.coach_can_access_client(client_id));

create policy programs_delete
on public.programs for delete to authenticated
using (private.coach_can_access_client(client_id));

create policy program_versions_select
on public.program_versions for select to authenticated
using (
  private.coach_can_access_program(program_id)
  or private.client_can_access_program_version(id)
);

create policy program_versions_insert
on public.program_versions for insert to authenticated
with check (private.coach_can_access_program(program_id));

create policy program_versions_update
on public.program_versions for update to authenticated
using (private.coach_can_access_program(program_id))
with check (private.coach_can_access_program(program_id));

create policy program_versions_delete
on public.program_versions for delete to authenticated
using (private.coach_can_access_program(program_id));

create policy program_weeks_select
on public.program_weeks for select to authenticated
using (
  private.coach_can_access_program_version(program_version_id)
  or private.client_can_access_program_version(program_version_id)
);

create policy program_weeks_insert
on public.program_weeks for insert to authenticated
with check (private.coach_can_access_program_version(program_version_id));

create policy program_weeks_update
on public.program_weeks for update to authenticated
using (private.coach_can_access_program_version(program_version_id))
with check (private.coach_can_access_program_version(program_version_id));

create policy program_weeks_delete
on public.program_weeks for delete to authenticated
using (private.coach_can_access_program_version(program_version_id));

create policy workouts_select
on public.workouts for select to authenticated
using (
  private.coach_can_access_week(program_week_id)
  or private.client_can_access_week(program_week_id)
);

create policy workouts_insert
on public.workouts for insert to authenticated
with check (private.coach_can_access_week(program_week_id));

create policy workouts_update
on public.workouts for update to authenticated
using (private.coach_can_access_week(program_week_id))
with check (private.coach_can_access_week(program_week_id));

create policy workouts_delete
on public.workouts for delete to authenticated
using (private.coach_can_access_week(program_week_id));

create policy workout_exercises_select
on public.workout_exercises for select to authenticated
using (
  private.coach_can_access_workout(workout_id)
  or private.client_can_read_workout_exercise(id)
);

create policy workout_exercises_insert
on public.workout_exercises for insert to authenticated
with check (private.coach_can_access_workout(workout_id));

create policy workout_exercises_update
on public.workout_exercises for update to authenticated
using (private.coach_can_access_workout(workout_id))
with check (private.coach_can_access_workout(workout_id));

create policy workout_exercises_delete
on public.workout_exercises for delete to authenticated
using (private.coach_can_access_workout(workout_id));

create policy assignments_select
on public.assignments for select to authenticated
using (
  private.coach_can_access_client(client_id)
  or private.client_can_read_assignment(id)
);

create policy assignments_insert
on public.assignments for insert to authenticated
with check (private.coach_can_access_client(client_id));

create policy assignments_update
on public.assignments for update to authenticated
using (private.coach_can_access_client(client_id))
with check (private.coach_can_access_client(client_id));

create policy assignments_delete
on public.assignments for delete to authenticated
using (private.coach_can_access_client(client_id));

create policy workout_sessions_select
on public.workout_sessions for select to authenticated
using (private.can_access_session(id));

create policy workout_sessions_insert
on public.workout_sessions for insert to authenticated
with check (
  client_id = private.current_client_id()
  and (
    assignment_id is null
    or private.client_can_read_assignment(assignment_id)
  )
);

create policy workout_sessions_update
on public.workout_sessions for update to authenticated
using (private.client_owns_session(id))
with check (
  client_id = private.current_client_id()
  and (
    assignment_id is null
    or private.client_can_read_assignment(assignment_id)
  )
);

create policy session_exercises_select
on public.session_exercises for select to authenticated
using (private.can_access_session(session_id));

create policy session_exercises_insert
on public.session_exercises for insert to authenticated
with check (
  private.client_owns_session(session_id)
  and (
    workout_exercise_id is null
    or private.client_can_read_workout_exercise(workout_exercise_id)
  )
  and private.client_can_read_exercise(exercise_id)
);

create policy session_exercises_update
on public.session_exercises for update to authenticated
using (private.client_owns_session(session_id))
with check (
  private.client_owns_session(session_id)
  and (
    workout_exercise_id is null
    or private.client_can_read_workout_exercise(workout_exercise_id)
  )
  and private.client_can_read_exercise(exercise_id)
);

create policy session_sets_select
on public.session_sets for select to authenticated
using (private.can_access_session_exercise(session_exercise_id));

create policy session_sets_insert
on public.session_sets for insert to authenticated
with check (private.client_owns_session_exercise(session_exercise_id));

create policy session_sets_update
on public.session_sets for update to authenticated
using (private.client_owns_session_exercise(session_exercise_id))
with check (private.client_owns_session_exercise(session_exercise_id));

revoke all on all tables in schema public from anon;

grant select, insert, update on
  public.profiles,
  public.clients,
  public.coach_clients,
  public.exercises,
  public.programs,
  public.program_versions,
  public.program_weeks,
  public.workouts,
  public.workout_exercises,
  public.assignments,
  public.workout_sessions,
  public.session_exercises,
  public.session_sets
to authenticated;

grant delete on
  public.clients,
  public.coach_clients,
  public.exercises,
  public.programs,
  public.program_versions,
  public.program_weeks,
  public.workouts,
  public.workout_exercises,
  public.assignments
to authenticated;

revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

commit;