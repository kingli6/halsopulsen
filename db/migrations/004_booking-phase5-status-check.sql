-- Development-only repair for databases whose original unnamed status check
-- was generated as appointments_status_check.

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_valid;

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE booking.appointments
  ADD CONSTRAINT appointments_status_valid
  CHECK (status IN ('pending', 'alternative_suggested', 'confirmed', 'cancelled', 'completed'));