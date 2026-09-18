-- Ensure reusable clientless programs are readable by their owning coach.

begin;

drop policy if exists programs_select on public.programs;
create policy programs_select
on public.programs for select to authenticated
using (
  private.coach_can_access_program(id)
  or private.client_can_access_program(id)
);

commit;