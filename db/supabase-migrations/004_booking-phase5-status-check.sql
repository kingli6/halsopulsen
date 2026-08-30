-- Idempotent status constraint repair for the Phase 5 approval workflow.

BEGIN;

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_valid;

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE booking.appointments
  ADD CONSTRAINT appointments_status_valid
  CHECK (status IN ('pending', 'alternative_suggested', 'confirmed', 'cancelled', 'completed'));

INSERT INTO booking.schema_migrations (filename)
VALUES ('004_booking-phase5-status-check.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;