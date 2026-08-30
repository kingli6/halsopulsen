-- Production Supabase migration for the unscheduled pending booking model.

BEGIN;

ALTER TABLE booking.appointments
  ALTER COLUMN starts_at DROP NOT NULL,
  ALTER COLUMN ends_at DROP NOT NULL;

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_end_after_start;

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_check;

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_current_time_pair;

ALTER TABLE booking.appointments
  ADD CONSTRAINT appointments_current_time_pair
  CHECK (
    (starts_at IS NULL AND ends_at IS NULL)
    OR (
      starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND ends_at > starts_at
    )
  );

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_no_active_overlap;

UPDATE booking.appointments
SET original_starts_at = COALESCE(original_starts_at, starts_at),
    original_ends_at = COALESCE(original_ends_at, ends_at),
    starts_at = NULL,
    ends_at = NULL
WHERE status IN ('pending', 'alternative_suggested');

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_time_valid;

ALTER TABLE booking.appointments
  ADD CONSTRAINT appointments_status_time_valid
  CHECK (
    (
      status = 'pending'
      AND starts_at IS NULL
      AND ends_at IS NULL
    )
    OR (
      status = 'alternative_suggested'
      AND starts_at IS NULL
      AND ends_at IS NULL
      AND alternative_starts_at IS NOT NULL
      AND alternative_ends_at IS NOT NULL
      AND alternative_ends_at > alternative_starts_at
    )
    OR (
      status IN ('confirmed', 'completed')
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND ends_at > starts_at
    )
    OR (
      status = 'cancelled'
      AND (
        (starts_at IS NULL AND ends_at IS NULL)
        OR (
          starts_at IS NOT NULL
          AND ends_at IS NOT NULL
          AND ends_at > starts_at
        )
      )
    )
  );

ALTER TABLE booking.appointments
  ADD CONSTRAINT appointments_no_active_overlap
  EXCLUDE USING gist (
    tstzrange(
      CASE
        WHEN status = 'alternative_suggested' THEN alternative_starts_at
        ELSE starts_at
      END,
      CASE
        WHEN status = 'alternative_suggested' THEN alternative_ends_at
        ELSE ends_at
      END,
      '[)'
    ) WITH &&
  )
  WHERE (
    (
      status = 'confirmed'
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
    )
    OR (
      status = 'alternative_suggested'
      AND alternative_starts_at IS NOT NULL
      AND alternative_ends_at IS NOT NULL
    )
  );

INSERT INTO booking.schema_migrations (filename)
VALUES ('005_booking-unscheduled-pending.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;