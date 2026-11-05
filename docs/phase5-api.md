# Phase 5 API contract — CCTV (browser WebRTC + optional YouTube Live)

Client build target for live boarding cameras. Auth: `Authorization: Bearer <access_token>`.
Base: `/api`. Default media is **peer-to-peer WebRTC** (`getUserMedia` on a sitter-authenticated device at the venue). A camera may instead use **YouTube Live** (`source: "youtube"`). The API **never stores media**, stream keys, or full YouTube URLs — only an 11-character video id. Signalling SDP/ICE is held briefly in `camera_signals` (TTL ~5 minutes) so `pg_notify` can carry an id instead of the body. YouTube cameras do **not** use ICE or signalling.

Build-spec §4: an owner may view only while the booking is `in_service`, the service is **boarding** at that venue, and `now` is inside the camera grant `validFrom..validTo` (grant window = booking check-in/out).

---

## Why SSE (not Supabase Realtime)

Chat and GPS already fan out over **PostgreSQL `LISTEN/NOTIFY` + Server-Sent Events**. CCTV signalling reuses that stack:

- `cameras` status / `is_enabled` fire `pg_notify('camera_events', …)` (migration `008`)
- WebRTC offer/answer/ICE is `POST`ed (write-time authz), stored in `camera_signals` (migration `009`), then `pg_notify` carries **only the row id**. The listener **loads that row once** (`findSignalById`; UUID-validated) and **fans out in memory** to subscribers that pass recipient scope (`toUserId`, plus sitter/booking/camera/session when present). Cross-user subscribers do not receive the body.
- the listener uses `LISTEN_DATABASE_URL` (session pooler `:5432` or direct), same as chat/walk
- no Realtime product, RLS, or client keys on the free tier
- same Bearer `fetch` + `ReadableStream` as chat (EventSource cannot set headers)

---

## Camera mode

One **publisher** (sitter device at the venue) → a few **viewers** (booking owners). Mesh: each viewer has its own `RTCPeerConnection` on the publisher.

1. Sitter registers cameras (`POST /api/sitters/cameras`) and toggles them (`PATCH … { isEnabled }`). Optional: `PATCH … { source: "youtube", youtubeUrl }` (or `youtubeVideoId`) to use YouTube Live instead of WebRTC.
2. Venue device (WebRTC only): `GET /api/sitters/cameras/events` (SSE) + `POST …/heartbeat` every ~10s while `getUserMedia` is live. YouTube cameras skip this.
3. Owner, during an in-service boarding stay: `GET /api/bookings/:id/cameras`, then `GET …/cameras/events`.
4. Viewer creates a `sessionId`, `createOffer()`, `POST …/signal` `{ type: "offer", sessionId, sdp }`.
5. Publisher SSE receives the offer, `createAnswer()`, `POST /api/sitters/cameras/:id/signal` `{ type: "answer", sessionId, sdp }`.
6. ICE candidates both ways (`type: "ice"`). Media stays off the server.

Disabling a camera, leaving `in_service`, or the grant window ending sends `session-ended` to **both** ends.

---

## Sitter cameras

`GET /api/sitters/cameras` — list `{ id, sitterId, venueId, name, isEnabled, status, lastSeenAt, source, youtubeVideoId, gpsContext }`

`gpsContext` is `{ lat, lng }` from the sitter profile when both coordinates are set, otherwise `null`. Same field on owner `GET /api/bookings/:id/cameras`. No extra camera columns.

`POST /api/sitters/cameras` `{ name, venueId?, source?, youtubeUrl? | youtubeVideoId? }` → `201`. Default `source` is `webrtc`.

`GET /api/sitters/cameras/:id`

`PATCH /api/sitters/cameras/:id` `{ isEnabled, name?, source?, youtubeUrl? | youtubeVideoId? }` — build-spec `PATCH /sitter/cameras/:id`. `isEnabled: false` ends live WebRTC sessions. `source: "youtube"` ends leftover WebRTC sessions (`session-ended.reason`: `source_changed`).

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
        "source": "webrtc",
        "youtubeVideoId": null,
        "gpsContext": { "lat": 13.746, "lng": 100.534 },
        "validFrom": "2026-10-28T05:00:00.000Z",
        "validTo": "2026-11-15T05:00:00.000Z"
      }
    ]
  }
}
```

Disabled cameras stay in the list (`isEnabled: false`) so the tile can show “Sitter turned this camera off”. Signalling **or** `GET /api/ice` for a disabled camera is `403` (no TURN creds). YouTube cameras: ICE and signalling return **`400` `ICE and signalling are not used for YouTube cameras`** (after the same authz as WebRTC). Embed with `https://www.youtube.com/embed/{youtubeVideoId}`.

`GET /api/bookings/:id/cameras/events` — SSE (same gate as GET)

`POST /api/bookings/:id/cameras/:cameraId/signal`

```json
{ "type": "offer", "sessionId": "uuid-or-client-id", "sdp": "v=0…" }
{ "type": "ice", "sessionId": "…", "candidate": { "candidate": "candidate:…", "sdpMid": "0" } }
```

---

## YouTube Live (optional per camera)

WebRTC stays the default (`source: "webrtc"`). A sitter may switch a camera to YouTube Live:

`PATCH /api/sitters/cameras/:id`

```json
{ "source": "youtube", "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
{ "source": "youtube", "youtubeVideoId": "https://youtu.be/dQw4w9WgXcQ" }
{ "source": "youtube", "youtubeVideoId": "dQw4w9WgXcQ" }
{ "source": "webrtc" }
```

Accepted inputs (stored as the **11-character** id only):

- `https://www.youtube.com/watch?v=VIDEO_ID` (and `youtube.com`, `m.youtube.com`; extra query is fine)
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/live/VIDEO_ID`
- a bare 11-character id matching `^[A-Za-z0-9_-]{11}$`

Anything else is **`400` `Invalid YouTube video URL or id`**. Stream keys, RTMP URLs, embed/shorts/studio links, and custom live handles are rejected and **never stored**. Switching back to WebRTC clears `youtubeVideoId`.

`youtubeVideoId` is returned only to:

- the owning sitter (`GET /api/sitters/cameras`, `GET /api/sitters/cameras/:id`, booking list as the booking sitter)
- the booking **owner** with a valid covering grant, in-window, matching venue, camera **enabled** (same rules as WebRTC viewing)

Everyone else never sees it (`null` / 403 / 404). A disabled YouTube camera is still listed for a granted owner, with `youtubeVideoId: null`.

**Unlisted** YouTube Live videos are viewable by **anyone who has the link**. Typical delay is **5–30 seconds**; this is not real-time WebRTC. Sitters should treat the video id as a capability grant, same as handing someone the watch URL.

---

## ICE

`GET /api/ice` (Bearer) is **not** unscoped. **`cameraId` and/or `bookingId` is required.** Skip ICE for `source: "youtube"` cameras (server returns **`400`**).

| Query | Who | Gate |
|-------|-----|------|
| `cameraId` | that camera’s sitter | camera must be enabled |
| `bookingId` | booking owner | active covering grant, same venue, at least one enabled camera |
| both | owner (sitter still wins on `cameraId` if they own the camera) | grant + venue + enabled |
| neither | — | **`400` `cameraId or bookingId is required`** |

Wrong party / unknown camera → `404`. Owner without a covering grant or wrong venue → `403`. **Disabled camera** (sitter or owner) → **`403` `This camera is disabled`** — same as signalling; **no TURN creds**. **YouTube camera** (`source: "youtube"`) → **`400` `ICE and signalling are not used for YouTube cameras`**.

Always includes Google STUN (`stun:stun.l.google.com:19302`). Optional TURN from env (placeholders only — never commit real credentials):

- When `TURN_PROVIDER=cloudflare`: mint ~300s ICE via Cloudflare Realtime TURN (`CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN`). Mint runs **only after** the grant checks. Fetch timeout; on failure → STUN-only (log, no secrets). Production boot fails if those vars are missing. See `docs/turn.md`.
- When `TURN_SECRET` is set: coturn REST HMAC, **TTL 300s**. `username = <unixExpiry>:<userId>`, `credential = base64(HMAC-SHA1(secret, username))`.
- Static `TURN_USERNAME` / `TURN_CREDENTIAL` are a **fallback only** when `TURN_SECRET` is unset, and are still gated (same `cameraId`/`bookingId` check). They are never returned to an arbitrary logged-in user. Metered free-plan dashboard creds use this path.

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

Free tier: STUN-only is enough on many networks. For cross-NAT viewing set `TURN_PROVIDER=cloudflare` (recommended) or `TURN_URLS` + `TURN_SECRET` / static user/pass. Sign-up and Render vars: `docs/turn.md`.

---

## SSE events

Keepalive comments (`:` every 15s) match chat. Timestamps are UTC ISO-8601 with `Z`.

```
data: {"type":"snapshot","cameras":[…],"access":{…}}

data: {"type":"camera:status","cameraId":"…","status":"online","isEnabled":true,"lastSeenAt":"…Z"}

data: {"type":"signal","kind":"offer","sessionId":"…","cameraId":"…","bookingId":"…","sdp":"…"}

data: {"type":"session-ended","reason":"camera_disabled","sessionId":"…","cameraId":"…"}
```

`session-ended.reason`: `camera_disabled` | `camera_removed` | `window_ended` | `booking_ended` | `source_changed`

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

- signalling request body ≤ **16384** bytes (16KB). Chromium video+audio offers are ~6KB; they must not 413.
- `pg_notify` JSON is a **signal-ref** (`{ type: "signal-ref", signalId }`) ≤ **7000** bytes, under Postgres’s **8000**-byte cap. SDP/ICE are **not** in the NOTIFY payload.
- **40** posts / minute / camera+user (`429`)
- live sessions: **2 per owner per camera** and **8 total viewers per camera** (`429`)

Live session records are **in-memory on a single Render instance** (demo). Signalling bodies live in `camera_signals` (id, session_id, camera_id, booking_id, payload, created_at; index on created_at). Insert deletes rows older than **5 minutes**; the camera watch sweeps as well.

Signalling authz is three layers:

1. **Write** — `POST …/signal` (owner grant + venue + enabled, or camera sitter).
2. **Fetch** — one `findSignalById` per NOTIFY (not one query per connected client). Invalid UUIDs (`signalId`, `cameraId`, `bookingId`) are rejected **before Postgres** (`400 Invalid …` on HTTP; LISTEN skips the ref). `sessionId` is an opaque client id (non-empty), not a UUID column.
3. **Fan-out** — in memory, `signalMatchesScope` keeps recipient scoping (`toUserId`, plus sitter/booking/camera/session when the subscriber has them). Another user’s stream does not get the SDP.

SDP/ICE are not in the NOTIFY payload.

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
| YouTube camera (`source: youtube`) | 200 (id if granted) | **400** | **400** | 200 (CRUD / heartbeat); publisher signal **400** |

---

## Migration

`008_cctv_webrtc.sql` — `NOTIFY camera_events` on camera status/`is_enabled`; auto-insert `camera_access_grants` for boarding bookings (window = check-in/out in `Asia/Bangkok`). Grants match camera/booking `venue_id` (`IS NOT DISTINCT FROM`). The trigger also runs on date/time changes (`start_date`, `end_date`, `start_time`, `end_time`) and upserts `validFrom`/`validTo` (`ON CONFLICT DO UPDATE`, idempotent). Existing **`in_service` boarding** bookings are backfilled. Columns `status`, `is_enabled`, `last_seen_at` already exist from `002`. Optional `bookings.venue_id` (null = sitter default home).

`009_camera_signals.sql` — `camera_signals` table for short-lived offer/answer/ICE JSON (`id`, `session_id`, `camera_id`, `booking_id`, `payload`, `created_at`; index on `created_at`). NOTIFY sends the id only. The listener fetches once by id, then scopes delivery in memory.

`010_camera_youtube_source.sql` — `cameras.source` (`webrtc` default \| `youtube`) and nullable `youtube_video_id` (11-char check; `source = 'youtube'` requires the id). **Do not apply from the app.** Projects Manager applies it. This PR does not touch any live database.

**Do not apply from the app.** Projects Manager applies it. 001–009 are already on the live DB after Phase 5. This PR does not touch any live database.
