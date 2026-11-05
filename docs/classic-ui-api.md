# Classic UI API (draft branch)

This branch (`classic-ui`) is the API surface for the **classic** client. **`main` backs Pet Sitter Plus in production — do not merge this branch into `main`.**

Do **not** run `npm run db:migrate`, `db:seed`, or any other write against the live Plus Supabase project `dvdzzrcdhafhlvjxrabe`. Schema/SQL files in the repo are documentation + CI against disposable Postgres only. `db/migrate.mjs` / `seed` / `verify` refuse that project ref.

Existing Plus clients keep working: new fields are additive, legacy `POST /api/bookings` without `serviceType` is unchanged.

---

## Four features

| Feature | How |
|---------|-----|
| Overnight boarding / stay-with-pet offerings + bookings | `services` rows (`boarding`, `in_home` overnight). Alias `stay_with_pet` → `in_home` + `overnight`. Quote/create/lifecycle in `docs/phase3-api.md`. |
| Webcam/CCTV (WebRTC or YouTube Live) + optional GPS | Sitter camera CRUD + owner live view. `gpsContext` is the sitter profile lat/lng when set (`null` otherwise). YouTube Live: `docs/phase5-api.md`. |
| Dog-walking hire | `serviceType: dog_walking` quote/create + sitter accept/status. |
| Walk-along GPS | Sitter `walk/start|points|end`; owner SSE + history. `docs/phase4-api.md`. |

---

## Migrations (files only)

Already on Plus (applied by Projects Manager; this branch does not re-apply them):

| File | What |
|------|------|
| `002_services_cameras_walks.sql` | `services`, `cameras`, grants, `walks`, `walk_points` |
| `006_booking_phase3.sql` | booking service columns, address, status |
| `007_walk_tracking.sql` | one walk per booking + `NOTIFY walk_events` |
| `008_cctv_webrtc.sql` | camera NOTIFY + boarding grants |
| `009_camera_signals.sql` | short-lived SDP/ICE rows |
| `010_camera_youtube_source.sql` | `cameras.source` / `youtube_video_id` |

No new migration in this PR. Camera GPS is read from existing `sitter_profiles.latitude` / `longitude`. Offerings use the existing `services` table.

---

## Offerings (classic-ui additive)

Sitter-only. Omitted rows on PUT are **deactivated** (`is_active = false`), never deleted (bookings keep `service_id`).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/sitters/me` | Now includes `serviceOfferings` (active + inactive) |
| GET | `/api/sitters/me/services` | Same list |
| PUT | `/api/sitters/me/services` | `{ offerings: [...] }` replace set |
| GET | `/api/sitters/:id` | Public **active** offerings (unchanged shape) |

Offering object: `{ id?, type, mode, durationMinutes, priceAmount, currency, isActive }`.

`type`: `boarding` \| `dog_walking` \| `in_home` \| `stay_with_pet` (stored as `in_home` / `overnight`).

Quote/create also accept `serviceType: "stay_with_pet"` (overnight only). Response `serviceType` stays `in_home`.

---

## CCTV GPS context (classic-ui additive)

Camera payloads (`GET /api/sitters/cameras`, `GET /api/bookings/:id/cameras`, SSE snapshots) add:

```json
"gpsContext": { "lat": 13.746, "lng": 100.534 }
```

or `gpsContext: null` when the sitter has no profile coordinates. Existing clients ignore the field.

---

## Endpoint index

### Boarding / stay-with-pet / walk hire

- `POST /api/bookings/quote`
- `POST /api/bookings` (Phase 3 `serviceType`; legacy create without it still returns PaymentIntent `clientSecret`)
- `POST /api/bookings/:id/checkout`
- `GET/POST /api/bookings/owner[/:id]/{cancel,reschedule,review,report}`
- `GET/POST/PATCH /api/sitters/bookings[/:id]/{accept,decline,status}`

### Walk-along GPS

- `POST /api/sitters/bookings/:id/walk/{start,points,end}`
- `GET /api/bookings/:id/walk`
- `GET /api/bookings/:id/walk/points`
- `GET /api/bookings/:id/walk/events` (SSE)

### CCTV / YouTube Live / ICE

- `/api/sitters/cameras` CRUD + `/events` + `/:id/heartbeat` + `/:id/signal`
- `GET /api/bookings/:id/cameras` + `/cameras/events` + `POST …/cameras/:cameraId/signal`
- `GET /api/ice?cameraId=&bookingId=`

Full request/response shapes: `docs/phase3-api.md`, `docs/phase4-api.md`, `docs/phase5-api.md`.
