-- HälsoPulsen booking database foundation.
-- Seed defaults: PT, Kost, and Massage are each 60 minutes with a
-- 15-minute default post-session break. Seed inserts preserve later edits.

CREATE SCHEMA IF NOT EXISTS booking;

CREATE TABLE IF NOT EXISTS booking.services (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  default_break_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (default_break_minutes >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking.availability_rules (
  id BIGSERIAL PRIMARY KEY,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL CHECK (end_time > start_time),
  timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until DATE CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  ),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS availability_rules_lookup_idx
  ON booking.availability_rules (weekday, effective_from, effective_until)
  WHERE active;

CREATE TABLE IF NOT EXISTS booking.availability_overrides (
  id BIGSERIAL PRIMARY KEY,
  override_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
  is_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT availability_overrides_period_check CHECK (
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

CREATE INDEX IF NOT EXISTS availability_overrides_date_idx
  ON booking.availability_overrides (override_date)
  WHERE active;

CREATE TABLE IF NOT EXISTS booking.blocked_times (
  id BIGSERIAL PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS blocked_times_range_idx
  ON booking.blocked_times (starts_at, ends_at);

CREATE TABLE IF NOT EXISTS booking.appointments (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL REFERENCES booking.services (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  client_name TEXT NOT NULL CHECK (length(trim(client_name)) > 0),
  client_email TEXT NOT NULL CHECK (length(trim(client_email)) > 0),
  client_phone TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS appointments_calendar_idx
  ON booking.appointments (starts_at, ends_at);

CREATE INDEX IF NOT EXISTS appointments_status_idx
  ON booking.appointments (status, starts_at);

-- The booking MVP represents one bookable practitioner/calendar. Phase 2
-- should translate SQLSTATE 23P01 into a slot conflict. Cancelled records
-- do not reserve time; pending and confirmed records do.
ALTER TABLE booking.appointments
  DROP CONSTRAINT IF EXISTS appointments_no_active_overlap;

ALTER TABLE booking.appointments
  ADD CONSTRAINT appointments_no_active_overlap
  EXCLUDE USING gist (
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('pending', 'confirmed'));

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
  ('Massage', 'Massage', 60, 15, 3)
ON CONFLICT (name) DO NOTHING;