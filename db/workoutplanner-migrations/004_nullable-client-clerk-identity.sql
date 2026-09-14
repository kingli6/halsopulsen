-- Allow private-link clients to exist without a Clerk identity.

begin;

alter table public.profiles
  alter column clerk_user_id drop not null;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (
    (role = 'coach' and clerk_user_id is not null)
    or role = 'client'
  );

commit;