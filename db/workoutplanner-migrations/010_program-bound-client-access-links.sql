-- Bind each private client link to exactly one client-owned program.

begin;

alter table public.programs
  add constraint programs_id_client_id_key unique (id, client_id);

alter table public.client_access_links
  add column program_id uuid;

do $$
begin
  if exists (
    select 1
      from public.client_access_links
     where program_id is null
  ) then
    raise exception
      'Cannot backfill client_access_links.program_id automatically; each existing link needs an explicit client-program assignment';
  end if;
end
$$;

alter table public.client_access_links
  alter column program_id set not null;

alter table public.client_access_links
  add constraint client_access_links_program_client_fkey
  foreign key (program_id, client_id)
  references public.programs(id, client_id)
  on delete cascade;

drop index if exists public.client_access_links_one_active_per_client;

create unique index client_access_links_one_active_per_program
  on public.client_access_links (client_id, program_id)
  where revoked_at is null;

create index client_access_links_program_id_idx
  on public.client_access_links (program_id);

create or replace function private.validate_client_access_link_program()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_kind text;
begin
  select p.kind
    into target_kind
    from public.programs p
   where p.id = new.program_id
     and p.client_id = new.client_id;

  if target_kind is distinct from 'client' then
    raise exception
      'Private client links must target a client program belonging to the linked client'
      using errcode = '23514';
  end if;

  return new;
end
$$;

drop trigger if exists client_access_links_validate_program
  on public.client_access_links;

create trigger client_access_links_validate_program
before insert or update of client_id, program_id
on public.client_access_links
for each row
execute function private.validate_client_access_link_program();

create or replace function private.prevent_invalid_linked_program_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if exists (
    select 1
      from public.client_access_links l
     where l.program_id = old.id
  ) and (
    new.kind is distinct from 'client'
    or new.client_id is null
  ) then
    raise exception
      'A program with an active or historical private link must remain a client program with a client'
      using errcode = '23514';
  end if;

  return new;
end
$$;

drop trigger if exists programs_protect_linked_client_program
  on public.programs;

create trigger programs_protect_linked_client_program
before update of kind, client_id
on public.programs
for each row
execute function private.prevent_invalid_linked_program_update();

commit;