# Phase 5 API contract — CCTV (browser WebRTC)

Client build target for live boarding cameras. Auth: `Authorization: Bearer <access_token>`.
Base: `/api`. Media is **peer-to-peer WebRTC** (`getUserMedia` on a sitter-authenticated device at the venue). The API **never stores media, SDP, or ICE**.

Build-spec §4: an owner may view only while the booking is `in_service`, the service is **boarding** at that venue, and `now` is inside the camera grant `validFrom..validTo` (grant window = booking check-in/out).

---

## Why SSE (not Supabase Realtime)

Chat and GPS already fan out over **PostgreSQL `LISTEN/NOTIFY` + Server-Sent Events**. CCTV signalling reuses that stack:

- `cameras` status / `is_enabled` fire `pg_notify('camera_events', …)` (migration `008`)
- WebRTC offer/answer/ICE is `POST`ed, then `pg_notify` relays the JSON to the other peer’s SSE (payload capped so it fits NOTIFY)
- the listener uses `LISTEN_DATABASE_URL` (session pooler `:5432` or direct), same as chat/walk
- no Realtime product, RLS, or client keys on the free tier
- same Bearer `fetch` + `ReadableStream` as chat (EventSource cannot set headers)

---

## Camera mode

One **publisher** (sitter device at the venue) → a few **viewers** (booking owners). Mesh: each viewer has its own `RTCPeerConnection` on the publisher.

1. Sitter registers cameras (`POST /api/sitters/cameras`) and toggles them (`PATCH … { isEnabled }`).
2. Venue device: `GET /api/sitters/cameras/events` (SSE) + `POST …/heartbeat` every ~10s while `getUserMedia` is live.
3. Owner, during an in-service boarding stay: `GET /api/bookings/:id/cameras`, then `GET …/cameras/events`.
4. Viewer creates a `sessionId`, `createOffer()`, `POST …/signal` `{ type: "offer", sessionId, sdp }`.
5. Publisher SSE receives the offer, `createAnswer()`, `POST /api/sitters/cameras/:id/signal` `{ type: "answer", sessionId, sdp }`.
6. ICE candidates both ways (`type: "ice"`). Media stays off the server.

Disabling a camera, leaving `in_service`, or the grant window ending sends `session-ended` to **both** ends.

---

## Sitter cameras

`GET /api/sitters/cameras` — list `{ id, sitterId, venueId, name, isEnabled, status, lastSeenAt }`

`POST /api/sitters/cameras` `{ name, venueId? }` → `201`

`GET /api/sitters/cameras/:id`

`PATCH /api/sitters/cameras/:id` `{ isEnabled, name? }` — build-spec `PATCH /sitter/cameras/:id`. `isEnabled: false` ends live sessions.

`DELETE /api/sitters/cameras/:id`

`POST /api/sitters/cameras/:id/heartbeat` — `lastSeenAt = now()`, `status = online` (if enabled). Stale cameras (`lastSeenAt` older than **30s**) become `offline`.

`GET /api/sitters/cameras/events` — SSE snapshot then `camera:status` / `signal` / `session-ended`

`POST /api/sitters/cameras/:id/signal` — publisher answer or ICE (session must already exist from a viewer offer)

`status`: `online` | `offline` | `reconnecting`

---

## Owner live view

`GET /api/bookings/:id/cameras`

Allowed only when the caller is the booking **owner** (or the booking sitter) **and**, for the owner:

- service is boarding
- `booking.status = in_service`
- `now ∈ [validFrom, validTo]` for at least one grant

```json
{
  "data": {
    "bookingId": "…",
    "access": {
      "validFrom": "2026-10-28T05:00:00.000Z",
      "validTo": "2026-11-15T05:00:00.000Z",
      "now": "2026-10-30T05:00:00.000Z",
      "canView": true
    },
    "cameras": [
      {
        "id": "…",
        "name": "Living room",
        "venueId": null,
        "isEnabled": true,
        "status": "online",
        "lastSeenAt": "2026-10-30T05:00:00.000Z",
        "validFrom": "2026-10-28T05:00:00.000Z",
        "validTo": "2026-11-15T05:00:00.000Z"
      }
    ]
  }
}
```

Disabled cameras stay in the list (`isEnabled: false`) so the tile can show “Sitter turned this camera off”. Signalling **or** `GET /api/ice` for a disabled camera is `403` (no TURN creds).

`GET /api/bookings/:id/cameras/events` — SSE (same gate as GET)

`POST /api/bookings/:id/cameras/:cameraId/signal`

```json
{ "type": "offer", "sessionId": "uuid-or-client-id", "sdp": "v=0…" }
{ "type": "ice", "sessionId": "…", "candidate": { "candidate": "candidate:…", "sdpMid": "0" } }
```

---

## ICE

`GET /api/ice` (Bearer) is **not** unscoped. **`cameraId` and/or `bookingId` is required.**

| Query | Who | Gate |
|-------|-----|------|
| `cameraId` | that camera’s sitter | camera must be enabled |
| `bookingId` | booking owner | active covering grant, same venue, at least one enabled camera |
| both | owner (sitter still wins on `cameraId` if they own the camera) | grant + venue + enabled |
| neither | — | **`400` `cameraId or bookingId is required`** |

Wrong party / unknown camera → `404`. Owner without a covering grant or wrong venue → `403`. **Disabled camera** (sitter or owner) → **`403` `This camera is disabled`** — same as signalling; **no TURN creds**.

Always includes Google STUN (`stun:stun.l.google.com:19302`). Optional TURN from env (placeholders only — never commit real credentials):

- When `TURN_SECRET` is set: coturn REST HMAC, **TTL 300s**. `username = <unixExpiry>:<userId>`, `credential = base64(HMAC-SHA1(secret, username))`.
- Static `TURN_USERNAME` / `TURN_CREDENTIAL` are a **fallback only** when `TURN_SECRET` is unset, and are still gated (same `cameraId`/`bookingId` check). They are never returned to an arbitrary logged-in user.

```json
{
  "data": {
    "iceServers": [
      { "urls": ["stun:stun.l.google.com:19302"] },
      { "urls": ["turn:turn.example.com:3478"], "username": "1770000000:user-uuid", "credential": "…" }
    ]
  }
}
```

Free tier: STUN-only is enough on many networks. Set `TURN_URLS` + `TURN_SECRET` (preferred) or static user/pass if you add a TURN server later.

---

## SSE events

Keepalive comments (`:` every 15s) match chat. Timestamps are UTC ISO-8601 with `Z`.

```
data: {"type":"snapshot","cameras":[…],"access":{…}}

data: {"type":"camera:status","cameraId":"…","status":"online","isEnabled":true,"lastSeenAt":"…Z"}

data: {"type":"signal","kind":"offer","sessionId":"…","cameraId":"…","bookingId":"…","sdp":"…"}

data: {"type":"session-ended","reason":"camera_disabled","sessionId":"…","cameraId":"…"}
```

`session-ended.reason`: `camera_disabled` | `camera_removed` | `window_ended` | `booking_ended`

---

## Handshake (publisher / viewer)

```
venue device                         API                            owner app
     |                                |                                 |
     | GET /sitters/cameras/events    |                                 |
     | POST /sitters/cameras/:id/heartbeat                              |
     |                                |  camera:status online           |
     |                                | ------------------------------> | GET /bookings/:id/cameras
     |                                |                                 | GET /bookings/:id/cameras/events
     | GET /ice?cameraId=             |                                 | GET /ice?bookingId=
     |                                |     POST …/signal offer         |
     |  SSE signal offer              | <------------------------------ |
     | POST …/signal answer           |                                 |
     |                                |     SSE signal answer           |
     |                                | ------------------------------> |
     | ICE both directions via POST …/signal { type: ice }              |
     | ============ SRTP media P2P (or TURN) ============               |
```

Limits (UTF-8 **bytes**, not JS `string.length` — Thai SDP is 3 bytes/char; oversized → **`413`**):

- signalling request body ≤ **6000** bytes
- full `pg_notify` JSON ≤ **7000** bytes (safely under Postgres’s **8000**-byte NOTIFY cap)
- **40** posts / minute / camera+user (`429`)
- live sessions: **2 per owner per camera** and **8 total viewers per camera** (`429`)

Live session records are **in-memory on a single Render instance** (demo). They are not shared across processes and are lost on restart. SDP/ICE are relayed in memory + NOTIFY, not written to a table.

A camera is listed / signalled only when `cameras.venue_id` matches `bookings.venue_id` (`IS NOT DISTINCT FROM`; both null = sitter’s default home). Mismatch → `403`.

---

Sitter SSE (`GET /api/sitters/cameras/events`) is scoped to **that sitter**. `camera:status` from another sitter’s camera is not delivered (the subscriber stores `sitterId`).

---

## Authz

Strangers get `404` (hide existence). The booking owner is a known party: wrong service / status / window / venue / disabled camera → `403`.

| Actor | GET booking cameras | POST viewer signal | GET `/api/ice` | Sitter CRUD / heartbeat / publisher signal |
|-------|---------------------|--------------------|----------------|---------------------------------------------|
| Booking sitter (own cameras) | 200 | — (use publisher path) | 200 (`cameraId`, enabled) | 200 |
| Booking owner, in-service boarding, in window, camera at this venue, enabled | 200 | 200 | 200 (`bookingId`) | 404 |
| Booking owner, camera at another venue | **403** (or omitted from list) | **403** | **403** | 404 |
| Booking owner, camera disabled | 200 (listed) | **403** | **403** (no TURN) | 404 |
| Booking owner, outside grant window | **403** | **403** | **403** | 404 |
| Booking owner, not `in_service` | **403** | **403** | **403** | 404 |
| Booking owner, not boarding | **403** | **403** | **403** | 404 |
| Other user / wrong booking | **404** | **404** | **404** | 404 |
| Unauthenticated | 401 | 401 | 401 | 401 |
| Logged-in, no `cameraId`/`bookingId` | — | — | **400** | — |

---

## Migration

`008_cctv_webrtc.sql` — `NOTIFY camera_events` on camera status/`is_enabled`; auto-insert `camera_access_grants` for boarding bookings (window = check-in/out in `Asia/Bangkok`). Grants match camera/booking `venue_id` (`IS NOT DISTINCT FROM`). The trigger also runs on date/time changes (`start_date`, `end_date`, `start_time`, `end_time`) and upserts `validFrom`/`validTo` (`ON CONFLICT DO UPDATE`, idempotent). Existing **`in_service` boarding** bookings are backfilled. Columns `status`, `is_enabled`, `last_seen_at` already exist from `002`. Optional `bookings.venue_id` (null = sitter default home).

**Do not apply from the app.** Projects Manager applies it. 001–007 are already on the live DB after Phase 4. This PR does not touch any live database.
