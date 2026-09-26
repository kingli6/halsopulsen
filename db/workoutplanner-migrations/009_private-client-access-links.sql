-- Pass 3 private client access links.
-- Raw bearer tokens are never stored; only SHA-256 hex digests are persisted.

begin;

create table if not exists public.client_access_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  token_hash text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint client_access_links_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists client_access_links_token_hash_unique
  on public.client_access_links (token_hash);

create unique index if not exists client_access_links_one_active_per_client
  on public.client_access_links (client_id)
  where revoked_at is null;

create index if not exists client_access_links_client_id_idx
  on public.client_access_links (client_id);

commit;