-- Stage 1 foundation for immutable published versions and exact workout logs.
-- This migration deliberately leaves existing session, assignment, program,
-- and private-link rows untouched.

BEGIN;

ALTER TABLE public.programs
  ADD COLUMN revision bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT programs_revision_nonnegative
    CHECK (revision >= 0);

ALTER TABLE public.workout_sessions
  ALTER COLUMN client_id DROP NOT NULL,
  ADD COLUMN workout_id uuid,
  ADD COLUMN program_id uuid,
  ADD CONSTRAINT workout_sessions_workout_id_fkey
    FOREIGN KEY (workout_id)
    REFERENCES public.workouts(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT workout_sessions_program_id_fkey
    FOREIGN KEY (program_id)
    REFERENCES public.programs(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT workout_sessions_program_association_check
    CHECK (
      program_id IS NULL
      OR (workout_id IS NULL AND assignment_id IS NULL)
    );

CREATE INDEX workout_sessions_workout_id_idx
  ON public.workout_sessions (workout_id);

CREATE INDEX workout_sessions_program_id_idx
  ON public.workout_sessions (program_id);

ALTER TABLE public.session_exercises
  ALTER COLUMN exercise_id DROP NOT NULL,
  ADD COLUMN activity_name text NOT NULL DEFAULT '',
  ADD CONSTRAINT session_exercises_exercise_or_activity_check
    CHECK (
      exercise_id IS NOT NULL
      OR length(btrim(activity_name)) > 0
    );

ALTER TABLE public.workout_sessions
  DROP CONSTRAINT workout_sessions_status_check,
  ADD CONSTRAINT workout_sessions_status_check
    CHECK (
      status IN (
        'in_progress',
        'recorded',
        'partial',
        'completed',
        'cancelled',
        'done',
        'skipped'
      )
    );

ALTER TABLE public.session_sets
  ADD COLUMN reps_provenance text NOT NULL DEFAULT 'unknown',
  ADD COLUMN duration_provenance text NOT NULL DEFAULT 'unknown',
  ADD COLUMN distance_provenance text NOT NULL DEFAULT 'unknown',
  ADD COLUMN load_provenance text NOT NULL DEFAULT 'unknown',
  ADD COLUMN rir_provenance text NOT NULL DEFAULT 'unknown',
  ADD COLUMN intensity_provenance text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.session_sets
  ADD CONSTRAINT session_sets_reps_provenance_check
    CHECK (
      reps_provenance IN ('reported', 'assumed', 'unknown')
      AND (reps IS NOT NULL OR reps_provenance = 'unknown')
      AND (reps_provenance <> 'assumed' OR reps IS NOT NULL)
    ),
  ADD CONSTRAINT session_sets_duration_provenance_check
    CHECK (
      duration_provenance IN ('reported', 'assumed', 'unknown')
      AND (duration IS NOT NULL OR duration_provenance = 'unknown')
      AND (duration_provenance <> 'assumed' OR duration IS NOT NULL)
    ),
  ADD CONSTRAINT session_sets_distance_provenance_check
    CHECK (
      distance_provenance IN ('reported', 'assumed', 'unknown')
      AND (distance IS NOT NULL OR distance_provenance = 'unknown')
      AND (distance_provenance <> 'assumed' OR distance IS NOT NULL)
    ),
  ADD CONSTRAINT session_sets_load_provenance_check
    CHECK (
      load_provenance IN ('reported', 'assumed', 'unknown')
      AND (load IS NOT NULL OR load_provenance = 'unknown')
      AND (load_provenance <> 'assumed' OR load IS NOT NULL)
    ),
  ADD CONSTRAINT session_sets_rir_provenance_check
    CHECK (
      rir_provenance IN ('reported', 'assumed', 'unknown')
      AND (rir IS NOT NULL OR rir_provenance = 'unknown')
      AND (rir_provenance <> 'assumed' OR rir IS NOT NULL)
    ),
  ADD CONSTRAINT session_sets_intensity_provenance_check
    CHECK (
      intensity_provenance IN ('reported', 'assumed', 'unknown')
      AND (intensity IS NOT NULL OR intensity_provenance = 'unknown')
      AND (intensity_provenance <> 'assumed' OR intensity IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION private.assert_program_version_is_draft(
  target_version_id uuid,
  allow_missing boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  version_status text;
BEGIN
  IF target_version_id IS NULL THEN
    IF allow_missing THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Program content must belong to an existing draft version'
      USING ERRCODE = '23514';
  END IF;

  SELECT pv.status
    INTO version_status
    FROM public.program_versions pv
   WHERE pv.id = target_version_id
   FOR SHARE NOWAIT;

  IF NOT FOUND THEN
    IF allow_missing THEN
      -- Cascading deletes of a draft version can reach its children after
      -- the parent row has become invisible to this trigger.
      RETURN;
    END IF;
    RAISE EXCEPTION 'Program content must belong to an existing draft version'
      USING ERRCODE = '23514';
  END IF;

  IF version_status <> 'draft' THEN
    RAISE EXCEPTION 'Published and archived program-version content is immutable'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_program_week_version(
  target_week_id uuid,
  expected_version_id uuid,
  allow_missing boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  actual_version_id uuid;
BEGIN
  IF target_week_id IS NULL THEN
    IF allow_missing THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Program content must belong to an existing program week'
      USING ERRCODE = '23514';
  END IF;

  SELECT pw.program_version_id
    INTO actual_version_id
    FROM public.program_weeks pw
   WHERE pw.id = target_week_id
   FOR SHARE NOWAIT;

  IF NOT FOUND THEN
    IF allow_missing THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Program content must belong to an existing program week'
      USING ERRCODE = '23503';
  END IF;

  IF actual_version_id IS DISTINCT FROM expected_version_id THEN
    RAISE EXCEPTION 'Program-week membership changed during the content edit; retry the operation'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_workout_program_week(
  target_workout_id uuid,
  expected_week_id uuid,
  allow_missing boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  actual_week_id uuid;
BEGIN
  IF target_workout_id IS NULL THEN
    IF allow_missing THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Program content must belong to an existing workout'
      USING ERRCODE = '23514';
  END IF;

  SELECT w.program_week_id
    INTO actual_week_id
    FROM public.workouts w
   WHERE w.id = target_workout_id
   FOR SHARE NOWAIT;

  IF NOT FOUND THEN
    IF allow_missing THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Program content must belong to an existing workout'
      USING ERRCODE = '23503';
  END IF;

  IF actual_week_id IS DISTINCT FROM expected_week_id THEN
    RAISE EXCEPTION 'Workout-week membership changed during the content edit; retry the operation'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_program_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Program versions must be created as drafts'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Published and archived program versions cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'published') THEN
      RAISE EXCEPTION 'A draft version can only remain a draft or be published'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published'
     AND NEW.status = 'archived'
     AND (to_jsonb(NEW) - 'status') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'status')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Published and archived program versions are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_program_version_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  old_version_id uuid;
  new_version_id uuid;
  old_week_id uuid;
  new_week_id uuid;
  old_workout_id uuid;
  new_workout_id uuid;
  lock_membership record;
  allow_missing boolean;
BEGIN
  allow_missing := TG_OP = 'DELETE';

  IF TG_TABLE_NAME = 'program_weeks' THEN
    IF TG_OP <> 'INSERT' THEN
      old_version_id := OLD.program_version_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_version_id := NEW.program_version_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'workouts' THEN
    IF TG_OP <> 'INSERT' THEN
      old_week_id := OLD.program_week_id;
      SELECT pw.program_version_id
        INTO old_version_id
        FROM public.program_weeks pw
       WHERE pw.id = old_week_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_week_id := NEW.program_week_id;
      SELECT pw.program_version_id
        INTO new_version_id
        FROM public.program_weeks pw
       WHERE pw.id = new_week_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'workout_exercises' THEN
    IF TG_OP <> 'INSERT' THEN
      old_workout_id := OLD.workout_id;
      SELECT pw.program_version_id
        INTO old_version_id
        FROM public.workouts w
        JOIN public.program_weeks pw ON pw.id = w.program_week_id
       WHERE w.id = old_workout_id;
      SELECT w.program_week_id
        INTO old_week_id
        FROM public.workouts w
       WHERE w.id = old_workout_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_workout_id := NEW.workout_id;
      SELECT pw.program_version_id
        INTO new_version_id
        FROM public.workouts w
        JOIN public.program_weeks pw ON pw.id = w.program_week_id
       WHERE w.id = new_workout_id;
      SELECT w.program_week_id
        INTO new_week_id
        FROM public.workouts w
       WHERE w.id = new_workout_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported program-version content table: %', TG_TABLE_NAME
      USING ERRCODE = '0A000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Lock both versions in UUID order. A content row is already locked by
    -- UPDATE before this trigger runs, so all ancestor locks use NOWAIT.
    -- This avoids waiting on a parent move/delete that may itself need a
    -- version lock. A changed parent mapping is rechecked after locking below.
    IF old_version_id IS NULL OR new_version_id IS NULL THEN
      PERFORM private.assert_program_version_is_draft(old_version_id, false);
      PERFORM private.assert_program_version_is_draft(new_version_id, false);
    ELSIF old_version_id <= new_version_id THEN
      PERFORM private.assert_program_version_is_draft(old_version_id, false);
      IF new_version_id IS DISTINCT FROM old_version_id THEN
        PERFORM private.assert_program_version_is_draft(new_version_id, false);
      END IF;
    ELSE
      PERFORM private.assert_program_version_is_draft(new_version_id, false);
      PERFORM private.assert_program_version_is_draft(old_version_id, false);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.assert_program_version_is_draft(old_version_id, true);
  ELSE
    PERFORM private.assert_program_version_is_draft(new_version_id, false);
  END IF;

  -- Lock/recheck ancestors in hierarchy order: versions (above), then weeks,
  -- then workouts. Within each level, parent IDs are sorted to keep concurrent
  -- moves consistent. The initial IDs above are only candidates; the helper
  -- functions lock each row and verify its current membership still matches.
  IF TG_TABLE_NAME IN ('workouts', 'workout_exercises') THEN
    FOR lock_membership IN
      SELECT membership.week_id, membership.version_id
        FROM (
          VALUES
            (old_week_id, old_version_id),
            (new_week_id, new_version_id)
        ) AS membership(week_id, version_id)
       WHERE membership.week_id IS NOT NULL
       ORDER BY membership.week_id, membership.version_id
    LOOP
      PERFORM private.assert_program_week_version(
        lock_membership.week_id,
        lock_membership.version_id,
        allow_missing
      );
    END LOOP;
  END IF;

  IF TG_TABLE_NAME = 'workout_exercises' THEN
    FOR lock_membership IN
      SELECT membership.workout_id, membership.week_id
        FROM (
          VALUES
            (old_workout_id, old_week_id),
            (new_workout_id, new_week_id)
        ) AS membership(workout_id, week_id)
       WHERE membership.workout_id IS NOT NULL
       ORDER BY membership.workout_id, membership.week_id
    LOOP
      PERFORM private.assert_workout_program_week(
        lock_membership.workout_id,
        lock_membership.week_id,
        allow_missing
      );
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.prevent_program_version_content_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE is not allowed for program-version content'
    USING ERRCODE = '55000';
  RETURN NULL;
END;
$$;

CREATE TRIGGER program_versions_protect_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON public.program_versions
FOR EACH ROW
EXECUTE FUNCTION private.protect_program_version_lifecycle();

CREATE TRIGGER program_weeks_protect_version_content
BEFORE INSERT OR UPDATE OR DELETE ON public.program_weeks
FOR EACH ROW
EXECUTE FUNCTION private.protect_program_version_content();

CREATE TRIGGER workouts_protect_version_content
BEFORE INSERT OR UPDATE OR DELETE ON public.workouts
FOR EACH ROW
EXECUTE FUNCTION private.protect_program_version_content();

CREATE TRIGGER workout_exercises_protect_version_content
BEFORE INSERT OR UPDATE OR DELETE ON public.workout_exercises
FOR EACH ROW
EXECUTE FUNCTION private.protect_program_version_content();

CREATE TRIGGER program_versions_prevent_truncate
BEFORE TRUNCATE ON public.program_versions
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_program_version_content_truncate();

CREATE TRIGGER program_weeks_prevent_truncate
BEFORE TRUNCATE ON public.program_weeks
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_program_version_content_truncate();

CREATE TRIGGER workouts_prevent_truncate
BEFORE TRUNCATE ON public.workouts
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_program_version_content_truncate();

CREATE TRIGGER workout_exercises_prevent_truncate
BEFORE TRUNCATE ON public.workout_exercises
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_program_version_content_truncate();

CREATE OR REPLACE FUNCTION private.validate_workout_session_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  assignment_workout_id uuid;
  assignment_client_id uuid;
  effective_workout_id uuid;
  version_status text;
  source_relationship_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    source_relationship_changed := true;
  ELSE
    source_relationship_changed :=
      NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
      OR NEW.workout_id IS DISTINCT FROM OLD.workout_id
      OR NEW.program_id IS DISTINCT FROM OLD.program_id;
  END IF;

  IF NEW.assignment_id IS NOT NULL THEN
    SELECT a.workout_id, a.client_id
      INTO assignment_workout_id, assignment_client_id
      FROM public.assignments a
     WHERE a.id = NEW.assignment_id
     FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The session assignment does not exist'
        USING ERRCODE = '23503';
    END IF;

    IF NEW.client_id IS NULL
       OR NEW.client_id IS DISTINCT FROM assignment_client_id
    THEN
      RAISE EXCEPTION 'A client-linked session must keep its assignment client'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.workout_id IS NULL THEN
      -- Retain editability of any legacy assignment-backed row without
      -- rewriting it. New planned sessions must store workout_id directly.
      IF TG_OP = 'UPDATE'
         AND OLD.workout_id IS NULL
         AND NEW.assignment_id IS NOT DISTINCT FROM OLD.assignment_id
         AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
      THEN
        effective_workout_id := assignment_workout_id;
      ELSE
        RAISE EXCEPTION 'A planned session must reference its workout'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NEW.workout_id IS DISTINCT FROM assignment_workout_id THEN
        RAISE EXCEPTION 'The session workout must match its assignment workout'
          USING ERRCODE = '23514';
      END IF;
      effective_workout_id := NEW.workout_id;
    END IF;
  ELSE
    effective_workout_id := NEW.workout_id;
  END IF;

  IF effective_workout_id IS NULL THEN
    -- Preserve existing unassociated history on unrelated edits only. New
    -- standalone sessions and any source reassociation must name a program.
    IF NEW.program_id IS NULL
       AND (TG_OP = 'INSERT' OR source_relationship_changed)
    THEN
      RAISE EXCEPTION 'Standalone sessions must reference a program'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.program_id IS NOT NULL THEN
    RAISE EXCEPTION 'Planned sessions derive their program from the workout'
      USING ERRCODE = '23514';
  END IF;

  IF effective_workout_id IS NOT NULL THEN
    SELECT pv.status
      INTO version_status
      FROM public.workouts w
      JOIN public.program_weeks pw ON pw.id = w.program_week_id
      JOIN public.program_versions pv ON pv.id = pw.program_version_id
     WHERE w.id = effective_workout_id;

    IF NOT FOUND OR version_status NOT IN ('published', 'archived') THEN
      RAISE EXCEPTION 'Planned sessions must reference a published or archived workout'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF source_relationship_changed AND EXISTS (
    SELECT 1
      FROM public.session_exercises se
     WHERE se.session_id = NEW.id
       AND (
         (
           effective_workout_id IS NULL
           AND (
             se.workout_exercise_id IS NOT NULL
             OR EXISTS (
               SELECT 1
                 FROM public.session_sets ss
                WHERE ss.session_exercise_id = se.id
                  AND (
                    ss.reps_provenance = 'assumed'
                    OR ss.duration_provenance = 'assumed'
                    OR ss.distance_provenance = 'assumed'
                    OR ss.load_provenance = 'assumed'
                    OR ss.rir_provenance = 'assumed'
                    OR ss.intensity_provenance = 'assumed'
                  )
             )
           )
         )
         OR (
           effective_workout_id IS NOT NULL
           AND (
             se.workout_exercise_id IS NULL
             OR NOT EXISTS (
               SELECT 1
                 FROM public.workout_exercises we
                WHERE we.id = se.workout_exercise_id
                  AND we.workout_id = effective_workout_id
                  AND we.exercise_id = se.exercise_id
             )
           )
         )
       )
  ) THEN
    RAISE EXCEPTION 'The session workout cannot conflict with its logged exercises'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_session_set_assumptions_match(
  target_session_exercise_id uuid,
  target_workout_id uuid,
  target_workout_exercise_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  prescription record;
BEGIN
  IF target_workout_exercise_id IS NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.session_sets ss
       WHERE ss.session_exercise_id = target_session_exercise_id
         AND (
           ss.reps_provenance = 'assumed'
           OR ss.duration_provenance = 'assumed'
           OR ss.distance_provenance = 'assumed'
           OR ss.load_provenance = 'assumed'
           OR ss.rir_provenance = 'assumed'
           OR ss.intensity_provenance = 'assumed'
         )
    ) THEN
      RAISE EXCEPTION 'Standalone activities cannot retain assumed prescription values'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  SELECT we.reps,
         we.duration,
         we.duration_unit,
         we.distance,
         we.distance_unit,
         we.load,
         we.load_unit,
         we.rir,
         we.intensity,
         we.intensity_unit
    INTO prescription
    FROM public.workout_exercises we
   WHERE we.id = target_workout_exercise_id
     AND we.workout_id = target_workout_id
   FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The assumed prescription must belong to the session workout'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.session_sets ss
     WHERE ss.session_exercise_id = target_session_exercise_id
       AND (
         (
           ss.reps_provenance = 'assumed'
           AND (prescription.reps IS NULL OR ss.reps IS DISTINCT FROM prescription.reps)
         )
         OR (
           ss.duration_provenance = 'assumed'
           AND (
             prescription.duration IS NULL
             OR ss.duration IS DISTINCT FROM prescription.duration
             OR ss.duration_unit IS DISTINCT FROM prescription.duration_unit
           )
         )
         OR (
           ss.distance_provenance = 'assumed'
           AND (
             prescription.distance IS NULL
             OR ss.distance IS DISTINCT FROM prescription.distance
             OR ss.distance_unit IS DISTINCT FROM prescription.distance_unit
           )
         )
         OR (
           ss.load_provenance = 'assumed'
           AND (
             prescription.load IS NULL
             OR ss.load IS DISTINCT FROM prescription.load
             OR ss.load_unit IS DISTINCT FROM prescription.load_unit
           )
         )
         OR (
           ss.rir_provenance = 'assumed'
           AND (prescription.rir IS NULL OR ss.rir IS DISTINCT FROM prescription.rir)
         )
         OR (
           ss.intensity_provenance = 'assumed'
           AND (
             prescription.intensity IS NULL
             OR ss.intensity IS DISTINCT FROM prescription.intensity
             OR ss.intensity_unit IS DISTINCT FROM prescription.intensity_unit
           )
         )
       )
  ) THEN
    RAISE EXCEPTION 'Assumed session-set values must match the workout prescription'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_session_exercise_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  session_workout_id uuid;
  session_assignment_id uuid;
  session_program_id uuid;
  effective_workout_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS NOT DISTINCT FROM OLD.session_id
       AND NEW.workout_exercise_id IS NOT DISTINCT FROM OLD.workout_exercise_id
       AND NEW.exercise_id IS NOT DISTINCT FROM OLD.exercise_id
    THEN
      -- Metadata-only edits must not strand legacy planned rows that predate
      -- workout_exercise_id. Any change to the source relationship is validated.
      RETURN NEW;
    END IF;
  END IF;

  SELECT ws.workout_id, ws.assignment_id, ws.program_id
    INTO session_workout_id, session_assignment_id, session_program_id
    FROM public.workout_sessions ws
   WHERE ws.id = NEW.session_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A session exercise must belong to an existing session'
      USING ERRCODE = '23503';
  END IF;

  effective_workout_id := session_workout_id;
  IF effective_workout_id IS NULL AND session_assignment_id IS NOT NULL THEN
    SELECT a.workout_id
      INTO effective_workout_id
      FROM public.assignments a
     WHERE a.id = session_assignment_id
     FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The legacy session assignment does not exist'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  IF effective_workout_id IS NULL THEN
    IF session_program_id IS NULL THEN
      RAISE EXCEPTION 'Standalone activity sessions must reference a program'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.workout_exercise_id IS NOT NULL THEN
      RAISE EXCEPTION 'Standalone activities cannot reference a planned exercise'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.workout_exercise_id IS NULL OR NEW.exercise_id IS NULL THEN
      RAISE EXCEPTION 'Planned session exercises require their prescribed exercise'
        USING ERRCODE = '23514';
    END IF;

    PERFORM 1
      FROM public.workout_exercises we
     WHERE we.id = NEW.workout_exercise_id
       AND we.workout_id = effective_workout_id
       AND we.exercise_id = NEW.exercise_id
     FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The planned exercise must match the session workout and stable exercise ID'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM private.assert_session_set_assumptions_match(
    NEW.id,
    effective_workout_id,
    NEW.workout_exercise_id
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_session_set_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  source_workout_exercise_id uuid;
  source_exercise_id uuid;
  session_workout_id uuid;
  session_assignment_id uuid;
  session_program_id uuid;
  effective_workout_id uuid;
  prescription record;
  has_assumed_metric boolean;
BEGIN
  has_assumed_metric :=
    NEW.reps_provenance = 'assumed'
    OR NEW.duration_provenance = 'assumed'
    OR NEW.distance_provenance = 'assumed'
    OR NEW.load_provenance = 'assumed'
    OR NEW.rir_provenance = 'assumed'
    OR NEW.intensity_provenance = 'assumed';

  SELECT se.workout_exercise_id,
         se.exercise_id,
         ws.workout_id,
         ws.assignment_id,
         ws.program_id
    INTO source_workout_exercise_id,
         source_exercise_id,
         session_workout_id,
         session_assignment_id,
         session_program_id
    FROM public.session_exercises se
    JOIN public.workout_sessions ws ON ws.id = se.session_id
   WHERE se.id = NEW.session_exercise_id
   FOR SHARE OF se, ws;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session sets require an existing session exercise'
      USING ERRCODE = '23503';
  END IF;

  effective_workout_id := session_workout_id;
  IF effective_workout_id IS NULL AND session_assignment_id IS NOT NULL THEN
    SELECT a.workout_id
      INTO effective_workout_id
      FROM public.assignments a
     WHERE a.id = session_assignment_id
     FOR SHARE;
  END IF;

  IF effective_workout_id IS NULL AND session_program_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Standalone activity sessions must reference a program'
        USING ERRCODE = '23514';
    ELSIF NEW.session_exercise_id IS DISTINCT FROM OLD.session_exercise_id THEN
      RAISE EXCEPTION 'Standalone activity sessions must reference a program'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT has_assumed_metric THEN
    RETURN NEW;
  END IF;

  IF effective_workout_id IS NULL OR source_workout_exercise_id IS NULL THEN
    RAISE EXCEPTION 'Standalone activities cannot use assumed prescription values'
      USING ERRCODE = '23514';
  END IF;

  SELECT we.reps,
         we.duration,
         we.duration_unit,
         we.distance,
         we.distance_unit,
         we.load,
         we.load_unit,
         we.rir,
         we.intensity,
         we.intensity_unit
    INTO prescription
    FROM public.workout_exercises we
   WHERE we.id = source_workout_exercise_id
     AND we.workout_id = effective_workout_id
     AND we.exercise_id IS NOT DISTINCT FROM source_exercise_id
   FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assumed metrics require the exact prescribed exercise'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW.reps_provenance = 'assumed'
    AND (prescription.reps IS NULL OR NEW.reps IS DISTINCT FROM prescription.reps)
  ) OR (
    NEW.duration_provenance = 'assumed'
    AND (
      prescription.duration IS NULL
      OR NEW.duration IS DISTINCT FROM prescription.duration
      OR NEW.duration_unit IS DISTINCT FROM prescription.duration_unit
    )
  ) OR (
    NEW.distance_provenance = 'assumed'
    AND (
      prescription.distance IS NULL
      OR NEW.distance IS DISTINCT FROM prescription.distance
      OR NEW.distance_unit IS DISTINCT FROM prescription.distance_unit
    )
  ) OR (
    NEW.load_provenance = 'assumed'
    AND (
      prescription.load IS NULL
      OR NEW.load IS DISTINCT FROM prescription.load
      OR NEW.load_unit IS DISTINCT FROM prescription.load_unit
    )
  ) OR (
    NEW.rir_provenance = 'assumed'
    AND (prescription.rir IS NULL OR NEW.rir IS DISTINCT FROM prescription.rir)
  ) OR (
    NEW.intensity_provenance = 'assumed'
    AND (
      prescription.intensity IS NULL
      OR NEW.intensity IS DISTINCT FROM prescription.intensity
      OR NEW.intensity_unit IS DISTINCT FROM prescription.intensity_unit
    )
  ) THEN
    RAISE EXCEPTION 'Assumed session-set values must match the workout prescription'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workout_sessions_validate_source
BEFORE INSERT OR UPDATE ON public.workout_sessions
FOR EACH ROW
EXECUTE FUNCTION private.validate_workout_session_source();

CREATE TRIGGER session_exercises_validate_source
BEFORE INSERT OR UPDATE ON public.session_exercises
FOR EACH ROW
EXECUTE FUNCTION private.validate_session_exercise_source();

CREATE TRIGGER session_sets_validate_provenance
BEFORE INSERT OR UPDATE ON public.session_sets
FOR EACH ROW
EXECUTE FUNCTION private.validate_session_set_provenance();

REVOKE ALL ON FUNCTION private.assert_program_version_is_draft(uuid, boolean) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION private.assert_program_week_version(uuid, uuid, boolean) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION private.assert_workout_program_week(uuid, uuid, boolean) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION private.protect_program_version_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_program_version_content() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.prevent_program_version_content_truncate() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_workout_session_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_session_set_assumptions_match(uuid, uuid, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION private.validate_session_exercise_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_session_set_provenance() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.protect_program_version_lifecycle() TO authenticated;
GRANT EXECUTE ON FUNCTION private.protect_program_version_content() TO authenticated;
GRANT EXECUTE ON FUNCTION private.prevent_program_version_content_truncate() TO authenticated;
GRANT EXECUTE ON FUNCTION private.validate_workout_session_source() TO authenticated;
GRANT EXECUTE ON FUNCTION private.validate_session_exercise_source() TO authenticated;
GRANT EXECUTE ON FUNCTION private.validate_session_set_provenance() TO authenticated;

COMMIT;
