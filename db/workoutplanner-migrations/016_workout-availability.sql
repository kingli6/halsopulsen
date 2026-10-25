ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'program';

UPDATE public.workouts
   SET availability = 'program'
 WHERE availability IS NULL
    OR availability NOT IN ('program', 'independent', 'both');

ALTER TABLE public.workouts
  ALTER COLUMN availability SET DEFAULT 'program',
  ALTER COLUMN availability SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workouts_availability_check'
       AND conrelid = 'public.workouts'::regclass
  ) THEN
    ALTER TABLE public.workouts
      ADD CONSTRAINT workouts_availability_check
      CHECK (availability IN ('program', 'independent', 'both'));
  END IF;
END $$;
