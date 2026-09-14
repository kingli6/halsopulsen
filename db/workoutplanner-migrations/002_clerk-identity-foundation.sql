-- WorkoutPlanner Pass 1: replace the Supabase Auth profile identity with Clerk.
--
-- This migration deliberately changes only the profile identity boundary.
-- clients and coach_clients continue to use internal UUID profile IDs.

begin;

do $$
declare
  constraint_name text;
begin
  /*
   * Do not assume PostgreSQL's generated foreign-key name. Find and remove
   * only the foreign key from public.profiles to auth.users.
   */
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.profiles'::regclass
      and con.confrelid = 'auth.users'::regclass
      and con.contype = 'f'
  loop
    execute format(
      'alter table public.profiles drop constraint %I',
      constraint_name
    );
  end loop;
end
$$;

alter table public.profiles
  alter column id set default gen_random_uuid();

alter table public.profiles
  add column if not exists clerk_user_id text;

do $$
begin
  if exists (
    select 1
    from public.profiles
    where clerk_user_id is null
  ) then
    raise exception
      'Cannot make profiles.clerk_user_id NOT NULL while existing profiles have no Clerk identity mapping';
  end if;
end
$$;

alter table public.profiles
  alter column clerk_user_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_clerk_user_id_key'
  ) then
    alter table public.profiles
      add constraint profiles_clerk_user_id_key unique (clerk_user_id);
  end if;
end
$$;

commit;