# Booking database layer

The booking module uses Replit development PostgreSQL through `DATABASE_URL`
outside production. In production, it requires the existing Supabase project
through `SUPABASE_DATABASE_URL`; `BOOKING_DATABASE_URL` can explicitly override
the booking connection for a separately configured backend. It is isolated
under the PostgreSQL `booking` schema and does not read or migrate the existing
JSON storage.

## Development commands

```text
npm run db:migrate
npm run test:booking-db
```

Migrations default to the development database. Set
`BOOKING_DATABASE_ENV=production` and the migration command refuses to run.
That existing migration runner remains development-only. The production
Supabase booking schema is created by the separate migration command below.

The production Supabase foundation migration is run separately with:

```text
node scripts/migrate-supabase-booking.js
```

That command requires `SUPABASE_DATABASE_URL` and deliberately refuses to use
`DATABASE_URL` as a fallback.

## Production seed data

The production Supabase migration adds these editable service defaults:

| Service | Duration | Default break | Display order |
| --- | ---: | ---: | ---: |
| PT | 60 minutes | 15 minutes | 1 |
| Kost | 60 minutes | 15 minutes | 2 |
| Massage | 60 minutes | 30 minutes | 3 |

The seed uses `ON CONFLICT (name) DO NOTHING`, so rerunning migrations does
not overwrite later service edits.

## Phase 2 constraint

The production Supabase foundation deliberately does not add an exclusion
constraint based only on `starts_at` and `ends_at`, because occupied time must
also include the effective post-session break. Phase 2 must enforce the
effective interval (`ends_at + break_minutes_override`, or the service default
when the override is NULL) transactionally for pending and confirmed
appointments. Cancelled appointments do not reserve time.

The current schema models one bookable practitioner/calendar. Supporting
multiple practitioners or rooms should add an explicit resource dimension
before those features are introduced.

## Phase 2 booking API

The server exposes these same-origin endpoints:

```text
GET  /api/booking/services
GET  /api/booking/availability?service=PT&from=YYYY-MM-DD&to=YYYY-MM-DD
POST /api/booking/requests
```

The availability response contains only public service details, available start
times, and private unavailable-slot markers (`booked` or `unavailable`) without
client information. The request body accepts `service`, `startAt` (or
`startTime`), `clientName`, `email`, and optional `phone` and `notes`. A
successful request creates a `pending` appointment and returns no appointment
or client record.

Availability is calculated on the server in `Europe/Stockholm` by default.
The default minimum notice is 12 hours, the booking horizon is 60 days, and
pending requests stop blocking slots after 24 hours. These values can be
configured with `BOOKING_TIMEZONE`, `BOOKING_MIN_NOTICE_HOURS`,
`BOOKING_HORIZON_DAYS`, `BOOKING_PENDING_EXPIRATION_HOURS`, and
`BOOKING_SLOT_INTERVAL_MINUTES`.

Pending expiration is lazy: expired rows are excluded from availability and
the final booking check without a background cleanup job. Booking requests
take a transaction-scoped calendar advisory lock, then recheck the complete
occupied interval including the effective break before inserting. This keeps
simultaneous requests from double-booking the single calendar.

The production integration checks run explicitly against Supabase:

```text
npm run test:booking-phase2
```