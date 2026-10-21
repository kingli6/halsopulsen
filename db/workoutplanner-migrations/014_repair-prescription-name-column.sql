-- Repair the prescription-name contract if migration 013 was missed or the
-- column was removed after it ran. Preserve every existing nonblank snapshot.

begin;

alter table public.workout_exercises
  add column if not exists exercise_name text;

update public.workout_exercises we
   set exercise_name = e.name
  from public.exercises e
 where e.id = we.exercise_id
   and (
     we.exercise_name is null
     or length(btrim(we.exercise_name)) = 0
   );

do $$
begin
  if exists (
    select 1
      from public.workout_exercises
     where exercise_name is null
        or length(btrim(exercise_name)) = 0
  ) then
    raise exception 'Cannot repair missing prescription names without a linked catalog exercise';
  end if;
end
$$;

alter table public.workout_exercises
  alter column exercise_name set not null,
  alter column exercise_id drop not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.workout_exercises'::regclass
       and conname = 'workout_exercises_exercise_name_not_blank'
  ) then
    alter table public.workout_exercises
      add constraint workout_exercises_exercise_name_not_blank
      check (length(btrim(exercise_name)) > 0);
  end if;
end
$$;

commit;
