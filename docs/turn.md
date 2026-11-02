# TURN for CCTV WebRTC (`GET /api/ice`)

Same-network viewing often works with **Google STUN only**. Cross-NAT / mobile / strict firewall needs a **TURN relay**. This API never stores media; it only hands `iceServers` to an already-authorized sitter or booking owner.

`GET /api/ice` stays gated: `cameraId` and/or `bookingId` is required. Grant, window, venue, and disabled-camera checks are unchanged (`403`, no TURN creds). Unauthorized callers never receive credentials. See `docs/phase5-api.md`.

The response shape is unchanged (`{ data: { iceServers } }`). **No client change.**

Never commit real secrets. Put them on Render only.

---

## What works with this code

| Option | How it maps | Free allowance (as of 2026-11) | Fits our ICE path? |
|--------|-------------|--------------------------------|--------------------|
| **Cloudflare Realtime TURN** | `TURN_PROVIDER=cloudflare` mints ~300s creds per authorized ICE call | First **1,000 GB/month** Realtime egress shared with SFU, then $0.05/GB | **Yes — recommended.** Short-lived creds, no static password in env. |
| **coturn REST HMAC** | `TURN_URLS` + `TURN_SECRET` | Self-hosted | **Yes.** Existing path. `username = <unixExpiry>:<userId>`, TTL 300s. |
| **Metered free plan (dashboard static creds)** | `TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL` (leave `TURN_SECRET` and `TURN_PROVIDER` unset) | **500 MB/month** ingress+egress; host `standard.relay.metered.ca` | **Yes**, via the existing static fallback. Tight for CCTV; use only as a backup. |
| **Open Relay public demo** (`openrelayproject` / `openrelayprojectsecret`) | Would be the same static fallback | Retired / globally restricted (401) | **No.** Do not use. Create a Metered dashboard credential instead. |

HMAC (`TURN_SECRET`) still wins over static user/pass when `TURN_PROVIDER` is not `cloudflare`. Cloudflare mode ignores `TURN_URLS` / `TURN_SECRET` / static user/pass.

On Cloudflare mint failure (timeout, HTTP error, missing vars outside production) the API logs **without secrets** and returns **STUN-only** so same-network viewing still works.

---

## Render env vars (Bell)

Set these on the **pet-sitter-app-server** web service. Do not add them to the repo.

### A — Cloudflare (recommended)

| Env var | Value |
|---------|--------|
| `TURN_PROVIDER` | `cloudflare` |
| `CLOUDFLARE_TURN_KEY_ID` | TURN key **uid** from the Cloudflare dashboard |
| `CLOUDFLARE_TURN_API_TOKEN` | TURN key **secret** (Bearer). Shown once at create. |

Do **not** set `TURN_URLS`, `TURN_SECRET`, `TURN_USERNAME`, or `TURN_CREDENTIAL` for this option.

In `NODE_ENV=production`, missing key id or token **fails boot**.

### B — Metered static (existing fallback)

| Env var | Value |
|---------|--------|
| `TURN_URLS` | Comma-separated URLs from Metered **Show ICE Servers Array**. Free plan: `turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:80?transport=tcp,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp` |
| `TURN_USERNAME` | Dashboard credential username |
| `TURN_CREDENTIAL` | Dashboard credential password |

Leave `TURN_PROVIDER` and `TURN_SECRET` **blank**. If `TURN_SECRET` is set, HMAC is used instead and Metered auth will fail.

### C — Own coturn

| Env var | Value |
|---------|--------|
| `TURN_URLS` | `turn:<host>:3478` (comma-separate extra `turns:` URLs) |
| `TURN_SECRET` | coturn REST shared secret |

Leave `TURN_PROVIDER` blank.

### STUN-only

Leave all TURN vars blank. Google STUN is always included.

---

## Sign-up: Cloudflare Realtime TURN

1. Create a Cloudflare account at [dash.cloudflare.com](https://dash.cloudflare.com) (free plan is enough).
2. Open **Realtime → TURN** (or [create a TURN key via API](https://developers.cloudflare.com/api/resources/calls/subresources/turn/methods/create/) with **Calls Write**).
3. Create a TURN key (name e.g. `pet-sitter-cctv`). Copy:
   - **Key ID** (`uid`) → `CLOUDFLARE_TURN_KEY_ID`
   - **Key secret** (`key`, shown once) → `CLOUDFLARE_TURN_API_TOKEN`
4. Keep the secret on the server only. It is **not** a browser ICE username.
5. On Render → service → Environment, set the three vars in table A. Redeploy.
6. Docs: [Generate credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/). This API `POST`s `https://rtc.live.cloudflare.com/v1/turn/keys/<KEY_ID>/credentials/generate-ice-servers` with `Authorization: Bearer <API_TOKEN>` and `{ "ttl": 300 }` after the caller passes ICE authz. Port 53 URLs (blocked in browsers) are dropped.

## Sign-up: Metered free plan

1. Sign up at [metered.ca](https://www.metered.ca) (no credit card). Pick the TURN **Free** plan (500 MB/month).
2. Dashboard → **TURN Server → Credentials → Create Credential**.
3. Wait up to ~2 minutes for the credential to propagate.
4. **Get credential → Show ICE Servers Array**. Copy URLs / username / password into table B. Free-plan host is `standard.relay.metered.ca` (not `global.relay.metered.ca`).
5. Do not use the old public Open Relay username `openrelayproject`.
6. Redeploy Render after setting the three static vars.

---

## Behaviour recap

- Authorized `GET /api/ice` only.
- Disabled camera / no grant / wrong venue → `403`, no mint, no static creds.
- Cloudflare: one mint per authorized call, TTL **300s**, `fetch` timeout 5s.
- Failure → STUN-only + `console.error` line that redacts the API token.
- Clients keep using `new RTCPeerConnection(data)` from `{ data: { iceServers } }`.
