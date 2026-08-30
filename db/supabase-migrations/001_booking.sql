-- HälsoPulsen booking foundation for the production Supabase PostgreSQL project.
-- This migration is intentionally separate from db/migrations/, whose runner
-- targets Replit development PostgreSQL only.

BEGIN;

CREATE SCHEMA IF NOT EXISTS booking;

CREATE TABLE IF NOT EXISTS booking.schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking.services (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL
    CONSTRAINT services_duration_positive CHECK (duration_minutes > 0),
  default_break_minutes INTEGER NOT NULL DEFAULT 0
    CONSTRAINT services_default_break_nonnegative CHECK (default_break_minutes >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0
    CONSTRAINT services_display_order_nonnegative CHECK (display_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking.availability_rules (
  id BIGSERIAL PRIMARY KEY,
  weekday SMALLINT NOT NULL
    CONSTRAINT availability_rules_weekday_valid CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL
    CONSTRAINT availability_rules_end_after_start CHECK (end_time > start_time),
  timezone TEXT NOT NULL
    CONSTRAINT availability_rules_timezone_present CHECK (length(trim(timezone)) > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT availability_rules_effective_dates_valid CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  )
);

CREATE TABLE IF NOT EXISTS booking.availability_overrides (
  id BIGSERIAL PRIMARY KEY,
  override_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  timezone TEXT NOT NULL
    CONSTRAINT availability_overrides_timezone_present CHECK (length(trim(timezone)) > 0),
  is_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT availability_overrides_period_valid CHECK (
    (
      is_unavailable
      AND start_time IS NULL
      AND end_time IS NULL
    )
    OR (
      NOT is_unavailable
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time > start_time
    )
  )
);

CREATE TABLE IF NOT EXISTS booking.blocked_times (
  id BIGSERIAL PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL
    CONSTRAINT blocked_times_end_after_start CHECK (ends_at > starts_at),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking.appointments (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL
    REFERENCES booking.services (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  client_name TEXT NOT NULL
    CONSTRAINT appointments_client_name_present CHECK (length(trim(client_name)) > 0),
  client_email TEXT NOT NULL
    CONSTRAINT appointments_client_email_present CHECK (length(trim(client_email)) > 0),
  client_phone TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL
    CONSTRAINT appointments_end_after_start CHECK (ends_at > starts_at),
  break_minutes_override INTEGER
    CONSTRAINT appointments_break_override_nonnegative
      CHECK (break_minutes_override IS NULL OR break_minutes_override >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT appointments_status_valid
      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  notes TEXT NOT NULL DEFAULT '',
  confirmation_token_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS services_active_order_idx
  ON booking.services (display_order, name)
  WHERE active;

CREATE INDEX IF NOT EXISTS availability_rules_lookup_idx
  ON booking.availability_rules (weekday, effective_from, effective_until)
  WHERE active;

CREATE INDEX IF NOT EXISTS availability_overrides_date_idx
  ON booking.availability_overrides (override_date)
  WHERE active;

CREATE INDEX IF NOT EXISTS blocked_times_range_idx
  ON booking.blocked_times (starts_at, ends_at);

CREATE INDEX IF NOT EXISTS appointments_calendar_idx
  ON booking.appointments (starts_at, ends_at);

CREATE INDEX IF NOT EXISTS appointments_status_idx
  ON booking.appointments (status, starts_at);

CREATE INDEX IF NOT EXISTS appointments_service_idx
  ON booking.appointments (service_id, starts_at);

CREATE OR REPLACE FUNCTION booking.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS services_set_updated_at ON booking.services;
CREATE TRIGGER services_set_updated_at
  BEFORE UPDATE ON booking.services
  FOR EACH ROW EXECUTE FUNCTION booking.set_updated_at();

DROP TRIGGER IF EXISTS availability_rules_set_updated_at
  ON booking.availability_rules;
CREATE TRIGGER availability_rules_set_updated_at
  BEFORE UPDATE ON booking.availability_rules
  FOR EACH ROW EXECUTE FUNCTION booking.set_updated_at();

DROP TRIGGER IF EXISTS availability_overrides_set_updated_at
  ON booking.availability_overrides;
CREATE TRIGGER availability_overrides_set_updated_at
  BEFORE UPDATE ON booking.availability_overrides
  FOR EACH ROW EXECUTE FUNCTION booking.set_updated_at();

DROP TRIGGER IF EXISTS blocked_times_set_updated_at ON booking.blocked_times;
CREATE TRIGGER blocked_times_set_updated_at
  BEFORE UPDATE ON booking.blocked_times
  FOR EACH ROW EXECUTE FUNCTION booking.set_updated_at();

DROP TRIGGER IF EXISTS appointments_set_updated_at ON booking.appointments;
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON booking.appointments
  FOR EACH ROW EXECUTE FUNCTION booking.set_updated_at();

INSERT INTO booking.services (
  name,
  description,
  duration_minutes,
  default_break_minutes,
  display_order
)
VALUES
  ('PT', 'Personlig träning', 60, 15, 1),
  ('Kost', 'Kostrådgivning', 60, 15, 2),
  ('Massage', 'Massage', 60, 30, 3)
ON CONFLICT (name) DO NOTHING;

INSERT INTO booking.schema_migrations (filename)
VALUES ('001_booking.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;