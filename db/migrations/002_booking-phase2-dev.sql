-- Development-only compatibility for the Phase 2 booking backend.
-- Production uses db/supabase-migrations/001_booking.sql.

ALTER TABLE booking.appointments
  ADD COLUMN IF NOT EXISTS break_minutes_override INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'appointments_break_override_nonnegative'
      AND n.nspname = 'booking'
      AND t.relname = 'appointments'
  ) THEN
    ALTER TABLE booking.appointments
      ADD CONSTRAINT appointments_break_override_nonnegative
      CHECK (break_minutes_override IS NULL OR break_minutes_override >= 0);
  END IF;
END $$;