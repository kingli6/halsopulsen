-- WorkoutPlanner Pass 2: distinguish reusable library programs from clones.

begin;

alter table public.programs
  add column if not exists kind text not null default 'library',
  add column if not exists source_program_id uuid,
  add column if not exists source_version_id uuid;

alter table public.programs
  add constraint programs_kind_check
  check (kind in ('library', 'client'));

alter table public.programs
  add constraint programs_kind_client_consistency_check
  check (
    (kind = 'library' and client_id is null and source_program_id is null and source_version_id is null)
    or kind = 'client'
  );

alter table public.programs
  add constraint programs_source_program_id_fkey
  foreign key (source_program_id)
  references public.programs(id)
  on delete restrict;

alter table public.programs
  add constraint programs_source_version_id_fkey
  foreign key (source_version_id)
  references public.program_versions(id)
  on delete restrict;

create index if not exists programs_coach_kind_status_idx
  on public.programs (coach_profile_id, kind, status, updated_at desc);

commit;