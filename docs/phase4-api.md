# Phase 4 API contract — GPS walk tracking

Client build target for live dog-walking trails. Auth: `Authorization: Bearer <access_token>`.
Base: `/api`. Coordinates are WGS84 decimal degrees for **Leaflet + OSM** (`L.polyline` / `L.circleMarker` on `lat`/`lng`).

Walker (the booking’s sitter) posts a point every 5–10 seconds while the **dog_walking** booking is `in_service`. Batches are accepted (reconnect / background flush). Only the booking owner and sitter may read the trail; everyone else gets `404` (same hide-existence pattern as booking detail).

---

## Why SSE (not Supabase Realtime)

Chat already fans out over **PostgreSQL `LISTEN/NOTIFY` + Server-Sent Events** (`GET /api/conversations/events`). Walk points reuse that stack:

- `walk_points` / `walks` fire `pg_notify('walk_events', …)` (migration `007`)
- the API holds one `LISTEN` connection and writes SSE frames to subscribers of that `bookingId`
- no extra Realtime product, RLS policies, or client keys on the free tier
- same `Authorization: Bearer` header as the rest of the API (use `fetch` + `ReadableStream`; `EventSource` cannot set headers)

Supabase Realtime would duplicate this channel and need table replication + client anon keys. Keep GPS on the existing SSE path; Phase 5 CCTV can still use Realtime for WebRTC signalling.

---

## Status gating

```
booking waiting_service  →  (sitter PATCH …/status → in_service)
booking in_service       →  POST …/walk/start  →  walk live
walk live                →  POST …/walk/points (5–10s)
walk live + in_service   →  POST …/walk/end    →  walk ended, booking completed
```

Start/end are tied to booking status: points and start require `in_service`; end stores the summary and moves `in_service → completed`. Not a dog-walking booking → `400`. Start is idempotent while the walk is `live`. Ending twice → `400` / `409`.

---

## Walker (sitter)

`POST /api/sitters/bookings/:id/walk/start`

`200 { data }` — `{ id, bookingId, walkerId, petIds, status, startedAt, distanceM, durationS }`

`POST /api/sitters/bookings/:id/walk/points`

Single point or batch:

```json
{ "lat": 13.7308, "lng": 100.5813, "accuracy": 6.0, "recordedAt": "2026-10-30T02:09:08.000Z" }
```

```json
{
  "points": [
    { "lat": 13.7308, "lng": 100.5813, "accuracy": 6.0, "recordedAt": "2026-10-30T02:09:00.000Z" },
    { "lat": 13.7309, "lng": 100.5814, "accuracy": 5.5, "recordedAt": "2026-10-30T02:09:08.000Z" }
  ]
}
```

Sanity checks (bad points are **skipped**, not 500):

| Rule | Limit |
|------|--------|
| `lat` / `lng` | −90…90 / −180…180 |
| `accuracy` | 0…5000 m (optional) |
| `recordedAt` | ISO-8601; not more than 30s in the future; not before walk start |
| interval | ≥ 2 seconds between kept points (client target 5–10s) |
| speed | drop hops faster than 20 m/s (~72 km/h GPS jump) |
| batch | ≤ 60 points |
| HTTP | ≤ 20 posts / minute / walk → `429` |

`200 { data: { accepted, skipped, distanceM, points } }`. If every point is rejected → `400`.

`POST /api/sitters/bookings/:id/walk/end`

Recomputes distance (haversine), duration, start/end coordinates, and a `lat,lng|…` polyline. Booking becomes `completed`.

---

## Owner live view

`GET /api/bookings/:id/walk/events` — SSE, owner **or** sitter.

First event is a snapshot:

```json
{ "type": "live", "bookingId": "…", "walk": { "id": "…", "status": "live", "summary": { } }, "points": [ ] }
```

If the walker has not started: `{ "type": "waiting", "walk": null, "points": [] }`.

Then:

```
data: {"type":"point","bookingId":"…","walkId":"…","point":{"id":12,"lat":13.7309,"lng":100.5814,"accuracy":5.5,"recordedAt":"…"}}

data: {"type":"ended","bookingId":"…","walkId":"…","walkStatus":"ended","distanceM":640,"durationS":420}
```

Keepalive comments (`:` every 15s) match chat. Plot each `point` on OSM; on `ended` freeze the line and load history if you need the full trail.

---

## Route history

`GET /api/bookings/:id/walk` — current walk + `lastPoint` + `summary`, or `data: null` if not started. Party only.

`GET /api/bookings/:id/walk/points?afterId=&limit=2000`

```json
{
  "data": {
    "walk": { "id": "…", "status": "ended", "distanceM": 2100, "durationS": 2760, "summary": "2.10 km in 46 min" },
    "summary": {
      "distanceM": 2100,
      "durationS": 2760,
      "startedAt": "2026-10-20T00:02:00.000Z",
      "endedAt": "2026-10-20T00:48:00.000Z",
      "start": { "lat": 13.7307, "lng": 100.5418 },
      "end": { "lat": 13.7307, "lng": 100.5418 }
    },
    "points": [
      { "id": 1, "lat": 13.7307, "lng": 100.5418, "accuracy": 4.0, "recordedAt": "2026-10-20T00:02:00.000Z" }
    ]
  }
}
```

---

## Authz

| Actor | start / points / end | GET walk / points / events |
|-------|----------------------|----------------------------|
| Booking sitter | yes | yes |
| Booking owner | `404` | yes |
| Anyone else | `404` | `404` |
| Unauthenticated | `401` | `401` |

---

## Migration

`007_walk_tracking.sql` — unique one-walk-per-booking (after deleting extras), `NOTIFY walk_events` triggers. **Do not apply from the app.** Projects Manager applies it. Tables `walks` / `walk_points` already exist from `002`.
