-- Allow a named library program to be published and shared without a client row.

begin;

alter table public.programs
  add column person_name text not null default '';

alter table public.programs
  add column published_start_date date;

-- Only treat the current date as published when there is no unpublished
-- version whose editor state could have already changed it.
update public.programs p
   set published_start_date = p.start_date
 where p.start_date is not null
   and exists (
     select 1
       from public.program_versions pv
      where pv.program_id = p.id
        and pv.status in ('published', 'archived')
   )
   and not exists (
     select 1
       from public.program_versions draft
      where draft.program_id = p.id
        and draft.status = 'draft'
   );

alter table public.client_access_links
  alter column client_id drop not null;

-- The existing composite FK remains in place for client-bound links. This
-- program-only FK also validates direct links whose client_id is null.
alter table public.client_access_links
  add constraint client_access_links_program_fkey
  foreign key (program_id)
  references public.programs(id)
  on delete cascade;

create unique index client_access_links_one_active_per_direct_program
  on public.client_access_links (program_id)
  where revoked_at is null
    and client_id is null;

create or replace function private.validate_client_access_link_program()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_kind text;
  target_client_id uuid;
begin
  select p.kind, p.client_id
    into target_kind, target_client_id
    from public.programs p
   where p.id = new.program_id;

  if not found then
    raise exception
      'Private links must target an existing program'
      using errcode = '23514';
  end if;

  if new.client_id is null then
    if target_kind is distinct from 'library' or target_client_id is not null then
      raise exception
        'Client-free private links must target a library program without a client'
        using errcode = '23514';
    end if;
  elsif target_kind is distinct from 'client'
     or target_client_id is distinct from new.client_id then
    raise exception
      'Client private links must target a client program belonging to the linked client'
      using errcode = '23514';
  end if;

  return new;
end
$$;

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
       and l.client_id is not null
  ) and (
    new.kind is distinct from 'client'
    or new.client_id is distinct from old.client_id
  ) then
    raise exception
      'A client-linked program must remain a client program with its client'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.client_access_links l
     where l.program_id = old.id
       and l.client_id is null
  ) and (
    new.kind is distinct from 'library'
    or new.client_id is distinct from old.client_id
  ) then
    raise exception
      'A directly shared program must remain a library program without a client'
      using errcode = '23514';
  end if;

  return new;
end
$$;

commit;
