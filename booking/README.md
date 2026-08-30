# Booking database layer

The booking module uses the project’s managed PostgreSQL database through
`DATABASE_URL`. It is isolated under the PostgreSQL `booking` schema and does
not read or migrate the existing JSON storage.

## Development commands

```text
npm run db:migrate
npm run test:booking-db
```

Migrations default to the development database. Set
`BOOKING_DATABASE_ENV=production` and the migration command refuses to run.
Production schema changes must go through the Replit Publish flow.

## Seed data

The first migration adds these editable service defaults:

| Service | Duration | Default break | Display order |
| --- | ---: | ---: | ---: |
| PT | 60 minutes | 15 minutes | 1 |
| Kost | 60 minutes | 15 minutes | 2 |
| Massage | 60 minutes | 15 minutes | 3 |

The seed uses `ON CONFLICT (name) DO NOTHING`, so rerunning migrations does
not overwrite later service edits.

## Phase 2 constraint

Pending and confirmed appointments use a PostgreSQL exclusion constraint on
their half-open timestamp ranges. Overlapping records fail with SQLSTATE
`23P01`; Phase 2 should translate that database error into a slot-conflict
response. Cancelled appointments do not reserve time.

The current schema models one bookable practitioner/calendar. Supporting
multiple practitioners or rooms should add an explicit resource dimension
before those features are introduced.