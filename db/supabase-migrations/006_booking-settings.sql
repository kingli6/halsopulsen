-- Persistent booking settings for the admin-configured booking window.

BEGIN;

CREATE TABLE IF NOT EXISTS booking.settings (
  id SMALLINT PRIMARY KEY DEFAULT 1
    CONSTRAINT booking_settings_singleton CHECK (id = 1),
  minimum_notice_hours INTEGER NOT NULL DEFAULT 0
    CONSTRAINT booking_settings_notice_nonnegative CHECK (minimum_notice_hours >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO booking.settings (id, minimum_notice_hours)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO booking.schema_migrations (filename)
VALUES ('006_booking-settings.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;