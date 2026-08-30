-- Development-only schema additions for the booking approval workflow.
-- Production uses db/supabase-migrations/002_booking-phase5.sql.

ALTER TABLE booking.appointments
  ADD COLUMN IF NOT EXISTS original_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alternative_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alternative_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_action_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS client_action_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_action_used_at TIMESTAMPTZ;

UPDATE booking.appointments
SET original_starts_at = COALESCE(original_starts_at, starts_at),
    original_ends_at = COALESCE(original_ends_at, ends_at)
WHERE original_starts_at IS NULL OR original_ends_at IS NULL;

ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_valid;

ALTER TABLE booking.appointments
  ADD CONSTRAINT appointments_status_valid
  CHECK (status IN ('pending', 'alternative_suggested', 'confirmed', 'cancelled', 'completed'));

CREATE UNIQUE INDEX IF NOT EXISTS appointments_client_action_token_idx
  ON booking.appointments (client_action_token_hash)
  WHERE client_action_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS appointments_alternative_expiry_idx
  ON booking.appointments (client_action_expires_at)
  WHERE status = 'alternative_suggested';