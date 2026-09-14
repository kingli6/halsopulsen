-- Minimal bearer-link foundation for read-only WorkoutPlanner client access.

begin;

alter table public.clients
  add column if not exists client_access_token_hash text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.clients'::regclass
      and conname = 'clients_client_access_token_hash_key'
  ) then
    alter table public.clients
      add constraint clients_client_access_token_hash_key
      unique (client_access_token_hash);
  end if;
end
$$;

alter table public.clients
  drop constraint if exists clients_client_access_token_hash_format;

alter table public.clients
  add constraint clients_client_access_token_hash_format
  check (
    client_access_token_hash is null
    or client_access_token_hash ~ '^[0-9a-f]{64}$'
  );

commit;