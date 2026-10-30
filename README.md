# 📌 Pet Sitter API Server

> REST API for the **Sitter\*** pet-sitting marketplace — owners, sitters, admin, bookings, chat, payments, and payouts.

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)]()
[![Express](https://img.shields.io/badge/Express-5.x-blue.svg)]()
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-336791.svg)]()
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)]()

**Live API:** https://pet-sitter-app-server.onrender.com  
**Frontend:** https://github.com/Kaopan11/pet-sitter-app-client  
**Client (this upgrade):** https://github.com/Teerapat-M/pet-sitter-app-client  
**Health check:** `GET /health`

---

## Pet Sitter Plus roadmap

Free tiers only (Supabase, Stripe test mode, Render, browser WebRTC). No secrets in the repo.

| Phase | What |
|-------|------|
| **1 — Schema** | Reverse-engineered existing Postgres schema as `db/migrations/001_init.sql`, plus services / cameras / grants / walks / walk_points in `002`, `users.onboarding_seen_at` in `003`, clip-camera grants on reschedule in `004`, `users.last_seen_at` + `conversations.booking_id` in `005`, booking Phase 3 columns in `006`, and walk unique-index + `NOTIFY` in `007`. `npm run db:migrate` and `db:seed` against `DATABASE_URL`. |
| **2 — Client design system** | Nunito; primary `#FF8A3D`, mint `#3CC8A8`, cream `#FFFAF3`. Restyle the existing app to the Penpot frames. First-visit onboarding: skippable welcome modal plus a 3–4 step walkthrough of services, booking, CCTV and GPS (frames D18/M18 from Penpot). Seen flag in `localStorage` and `users.onboarding_seen_at`; replay from the menu. |
| **3 — Services and booking** | Boarding, dog walking, and in-home (visit or overnight). Quote + create ignore client totals; overlap locked in a transaction; Stripe TEST Checkout + signed webhook; sitter accept/decline; `waiting_confirm → waiting_service → in_service → completed` (or `cancelled`). Conversation `booking_id` set on create. See `docs/phase3-api.md`. |
| **4 — Live GPS walks** | Walker posts points every 5–10s (batches OK) while a dog-walking booking is `in_service`. Owner live view is SSE (same LISTEN/NOTIFY stack as chat — see `docs/phase4-api.md`). Summary (distance, duration, start/end) is stored when the walk ends (`in_service → completed`). |
| **5 — CCTV** | Free WebRTC: sitter browser camera, Supabase Realtime signalling, short-lived signed access, `camera:status` event. Grants are limited to the booking window. |

---

## 📖 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Authentication](#-authentication)
- [API Reference](#-api-reference)
- [Integration with Frontend](#-integration-with-frontend)
- [API Documentation (Swagger)](#-api-documentation-swagger)
- [Deployment](#-deployment)
- [Testing](#-testing)
- [Known Limitations](#-known-limitations)
- [Contributors](#-contributors)
- [License](#-license)

---

## ✨ Features

- **Authentication** — Email register/login via Supabase Auth; Google/Facebook OAuth session (`/me`, `/oauth/complete`)
- **Password recovery** — Forgot-password email + reset flow
- **Users & pets** — Owner profiles and pet CRUD with avatar upload; public `GET /api/pet-types`
- **Sitters** — Public search/list, profile management, availability, reviews
- **Bookings** — Boarding / dog walking / in-home; server quote; owner create (cash or Stripe Checkout); sitter accept/decline and status workflow; cancel, reschedule, review, report
- **Payments** — Stripe TEST Checkout Session (Phase 3) or PaymentIntent (legacy); webhook signature verification; cash payout on `in_service` / `completed`
- **Payout** — Sitter earnings dashboard, Thai bank list, bank account + book-bank image upload
- **GPS walks** — Sitter start/points/end on an in-service dog walk; owner SSE live trail; history + haversine summary. Leaflet + OSM on the client.
- **Chat** — Owner–sitter messaging with image upload and SSE realtime events
- **Notifications** — In-app notification list and read state
- **Admin** — Sitter approval, owner ban, review moderation, booking oversight
- **Reports** — Booking reports (admin workflow)

---

## 🛠️ Tech Stack

| Layer | Technology |
|--------|------------|
| **Runtime** | Node.js 22+ (ES modules) |
| **Framework** | Express 5 |
| **Database** | PostgreSQL 15+ (`pg`) on Supabase |
| **Auth** | Supabase Auth + JWT (JWKS) |
| **Payments** | Stripe (webhooks, manual capture) |
| **File upload** | multer → Supabase Storage (`photos` bucket) |
| **Realtime chat / GPS** | PostgreSQL `LISTEN/NOTIFY` + Server-Sent Events |
| **Dev** | nodemon |
| **Tests** | Node.js built-in test runner |

---

## 🏗️ Architecture

```
┌─────────────────┐     HTTPS      ┌──────────────────┐
│  Next.js Client │ ──────────────► │  Express API     │
│  (Vercel)       │   Bearer JWT    │  (Render)        │
└────────┬────────┘                 └────────┬─────────┘
         │                                   │
         │ OAuth (Google/FB)                 │ SQL
         ▼                                   ▼
┌─────────────────┐                 ┌──────────────────┐
│  Supabase Auth  │                 │  PostgreSQL      │
└─────────────────┘                 │  (Supabase)      │
                                      └──────────────────┘
         Stripe ◄──────────────────► Webhook + PaymentIntent
```

**Request flow:** `routes` → `middlewares` → `controllers` → `services` → `repositories` → PostgreSQL / Supabase / Stripe

---

## 📁 Project Structure

```text
pet-sitter-app-server/
├── app.mjs                 # Entry point, CORS, routes, error handler
├── db/
│   ├── migrate.mjs         # npm run db:migrate
│   ├── seed.mjs            # npm run db:seed
│   ├── seed.sql
│   └── migrations/
│       ├── 001_init.sql
│       ├── 002_services_cameras_walks.sql
│       ├── 003_onboarding_seen_at.sql
│       ├── 004_clip_camera_grants_on_reschedule.sql
│       ├── 005_conversation_booking_and_presence.sql
│       ├── 006_booking_phase3.sql
│       └── 007_walk_tracking.sql
├── docs/
│   ├── phase3-api.md           # Phase 3 request/response contract
│   └── phase4-api.md           # Phase 4 GPS walk contract (SSE + Leaflet)
├── package.json
├── routes/                 # HTTP route definitions
│   ├── auth.route.mjs
│   ├── users.route.mjs
│   ├── pets.route.mjs
│   ├── petTypes.route.mjs
│   ├── sitters.route.mjs
│   ├── bookings.route.mjs      # Sitter bookings (nested under /sitters)
│   ├── ownerBookings.route.mjs
│   ├── chat.route.mjs
│   ├── notifications.route.mjs
│   ├── banks.route.mjs
│   ├── admin.route.mjs
│   ├── adminSitters.route.mjs
│   ├── adminOwners.route.mjs
│   ├── reports.rout.mjs
│   └── stripeWebhook.route.mjs
├── controllers/            # Request/response handling
├── services/               # Business logic
├── repositories/           # Database & Supabase access
├── middlewares/            # Auth, validation, uploads
└── utils/                  # Helpers, validation, tests
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 22+
- npm
- PostgreSQL 15+ (Supabase Postgres, or local)
- Supabase project (Postgres + Auth)
- Stripe account (for card payments)

### Installation

```bash
git clone https://github.com/Kaopan11/pet-sitter-app-server.git
cd pet-sitter-app-server
npm install
```

### Environment

Copy `.env.example` to `.env` and fill in your values (see [Environment Variables](#-environment-variables)). **Do not commit `.env`.**

### Database (fresh Supabase or local Postgres)

```bash
npm run db:migrate   # apply db/migrations/*.sql, tracked in schema_migrations
npm run db:seed      # demo owners, sitters, pets, bookings, cameras, walks
```

Both commands read `DATABASE_URL`. Use the **direct** Postgres URI (port 5432), not the pooler, for DDL. Do not point these scripts at production unless you intend to.

Chat and GPS SSE use PostgreSQL `LISTEN/NOTIFY` on a **dedicated session connection**. If `DATABASE_URL` is the transaction pooler (`:6543`), set `LISTEN_DATABASE_URL` to the session pooler (`:5432`) or the direct URI. The query pool is unchanged. Listeners reconnect on connection error. In production, boot fails if `LISTEN_DATABASE_URL` is missing when `DATABASE_URL` is a transaction pooler, or if `LISTEN_DATABASE_URL` itself is a transaction pooler.

Migrations use `NULLS NOT DISTINCT` unique indexes and `EXECUTE FUNCTION` triggers, so **PostgreSQL 15 or later** is required (Supabase current Postgres and the CI service image both qualify).

### Run locally

```bash
npm run dev    # nodemon — http://localhost:4000
```

```bash
npm start      # production-style (node app.mjs)
```

Verify:

```bash
curl http://localhost:4000/health
# → { "status": "ok", "message": "Pet Sitter API is running" }
```

---

## 🔐 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres URI for the query pool. Production may use the Supabase **transaction** pooler (port **6543**). SSL is on for `sslmode=require` (`{ rejectUnauthorized: false }`) and for `verify-ca` / `verify-full` (`{ rejectUnauthorized: true }`), even on localhost. Off for unix-socket hosts (`host=/…` or a host starting with `/`), loopback, or `sslmode=disable`. Otherwise `{ rejectUnauthorized: false }`. |
| `LISTEN_DATABASE_URL` | Production if `DATABASE_URL` is a transaction pooler | Session pooler (port **5432**) or **direct** URI for `LISTEN/NOTIFY`. Used **only** by the chat and walk SSE listener clients. Transaction pooler connections cannot `LISTEN`. Falls back to `DATABASE_URL` outside that production check. Same SSL rules as the query pool, applied to this URI. In `NODE_ENV=production`, if `DATABASE_URL` is port **6543** or a pooler host with `pgbouncer`, missing `LISTEN_DATABASE_URL` fails at boot. A `LISTEN_DATABASE_URL` that is itself a transaction pooler (port **6543**, or a pooler host with `pgbouncer`) also fails at boot. |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only; Auth admin & storage (**never expose to FE**) |
| `SUPABASE_JWKS_URL` | Yes | `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` |
| `FRONTEND_URL` | Yes | Comma-separated frontend origins for CORS (localhost / `127.0.0.1` on ports 3000 and 3001 are always allowed). First URL is the password-reset redirect base (no trailing `/`) |
| `STRIPE_SECRET_KEY` | For payments | Stripe **test** secret (`sk_test_…`). Never commit live keys. |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Webhook signing secret (`whsec_…`) for `/api/webhooks/stripe` |
| `PORT` | No | Default `4000` (Render sets this automatically) |

See `.env.example` for a template with placeholder values.

---

## 🔑 Authentication

### Email register & login

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/register` | Create Supabase user + `public.users` (+ optional sitter profile) |
| `POST /api/auth/login` | Verify credentials; returns `{ data: { token, user } }` |

**`user` object (all auth success responses):**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "phone": "0992296633",
  "name": "Name",
  "avatarUrl": null,
  "isSitter": false,
  "isAdmin": false
}
```

### OAuth (Google / Facebook)

Handled on the **frontend** via Supabase. Backend endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/auth/me` | `Authorization: Bearer <supabase_access_token>` — 200 if profile exists; **404** `"Profile incomplete"` if not |
| `POST /api/auth/oauth/complete` | Create `public.users` with `{ name, phone }` on first social login |

### Protected routes

Send on every authenticated request:

```http
Authorization: Bearer <access_token>
```

Middleware: `requireAuth` → `requireSitter` / `requireAdmin` where applicable.

**Admin:** Same `POST /api/auth/login`; frontend checks `user.isAdmin` and routes to admin UI.

### Password reset

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/forgot-password` | `{ email }` — always returns same success message (anti-enumeration) |
| `POST /api/auth/reset-password` | `{ accessToken, newPassword }` from recovery email link |

---

## 📡 API Reference

Base URL: `http://localhost:4000` (local) · `https://pet-sitter-app-server.onrender.com` (production)

> **Auth column:** `—` = public · `Bearer` = logged-in user · `Sitter` = requires sitter profile · `Admin` = requires `isAdmin`

Interactive docs: [http://localhost:4000/api-docs](http://localhost:4000/api-docs) (local) · [https://pet-sitter-app-server.onrender.com/api-docs](https://pet-sitter-app-server.onrender.com/api-docs) (production)

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | API smoke test |
| GET | `/health` | — | Health check |

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | — | Email registration |
| POST | `/login` | — | Email login |
| GET | `/me` | Bearer | OAuth session resolve |
| POST | `/oauth/complete` | Bearer | Complete social profile |
| POST | `/forgot-password` | — | Request password reset |
| POST | `/reset-password` | — | Set new password |
| POST | `/become-sitter` | Bearer | Owner → sitter |

### Users — `/api/users`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | List users |
| GET | `/me` | Bearer | Current user |
| PATCH / PUT | `/me/onboarding` | Bearer | Set `onboarding_seen_at` (`{ seen: true }` or `{ seen: false }` to replay) |
| GET | `/me/pets` | Bearer | My pets (shortcut) |
| PUT | `/me` | Bearer | Update profile (+ avatar multipart) |

### Pets — `/api/pets`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Bearer | List my pets |
| POST | `/` | Bearer | Create pet |
| GET | `/:id` | Bearer | Pet detail |
| PUT | `/:id` | Bearer | Update pet |
| DELETE | `/:id` | Bearer | Delete pet |

### Pet types — `/api/pet-types`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | List pet types (`id`, `name`, ordered by `id`) |

### Sitters — `/api/sitters`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | Search/list sitters |
| GET | `/me` | Sitter | My sitter profile |
| PUT | `/me` | Sitter | Update profile + images |
| GET | `/me/payout` | Sitter | Payout transactions & earnings |
| GET | `/me/payout/bank-account` | Sitter | Get bank account |
| PUT | `/me/payout/bank-account` | Sitter | Update bank account |
| POST | `/me/payout/book-bank-image` | Sitter | Upload book-bank image |
| GET | `/:id` | — | Public sitter profile (`hasCctv`, `serviceOfferings`) |
| GET | `/:id/reviews` | — | Sitter reviews |
| GET | `/:id/availability` | — | Booking availability |

### Sitter bookings — `/api/sitters/bookings`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Sitter | Booking list |
| GET | `/:id` | Sitter | Booking detail (`has_cctv`, `owner_address`) |
| POST | `/:id/accept` | Sitter | `waiting_confirm` → `waiting_service` |
| POST | `/:id/decline` | Sitter | `waiting_confirm` → `cancelled` |
| PATCH | `/:id/status` | Sitter | Enforced transitions; `in_service` → `completed` |
| POST | `/:id/walk/start` | Sitter | Start live GPS walk (`in_service` dog walking) |
| POST | `/:id/walk/points` | Sitter | Post one point or a batch (5–10s, sanity checks) |
| POST | `/:id/walk/end` | Sitter | End walk, store summary, complete booking |

### Owner bookings — `/api/bookings`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/quote` | Bearer | Server-side price quote (`available`, `hasCctv`) |
| POST | `/` | Bearer | Create booking (cash \| stripe). Phase 3 sends `serviceType`. |
| POST | `/:id/checkout` | Bearer | Stripe TEST Checkout Session |
| GET | `/owner` | Bearer | Booking history |
| GET | `/owner/:id` | Bearer | Booking detail |
| POST | `/owner/:id/cancel` | Bearer | Cancel booking |
| POST | `/owner/:id/reschedule` | Bearer | Reschedule |
| POST | `/owner/:id/review` | Bearer | Submit review (`completed`) |
| POST | `/owner/:id/report` | Bearer | Report issue |
| GET | `/:id/walk` | Bearer | Current walk + summary (owner or sitter; others 404) |
| GET | `/:id/walk/points` | Bearer | Route history + summary |
| GET | `/:id/walk/events` | Bearer | SSE live trail (same auth as chat SSE) |

### Banks — `/api/banks`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | Thai bank list (payout UI) |

### Chat — `/api/conversations`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | Bearer | Create/find conversation |
| GET | `/` | Bearer | List conversations: `bookingId` + booking summary `{ id, service_name, dates, pets, status, transactionNo }` (null if unlinked); `otherUser.lastSeenAt` / `isOnline`; `otherUser.phone` only for confirmed/in-service bookings |
| GET | `/events` | Bearer | SSE realtime stream |
| GET | `/:id/messages` | Bearer | Message history |
| POST | `/:id/messages` | Bearer | Send message (+ image) |
| POST | `/:id/read` | Bearer | Mark as read |

### Notifications — `/api/notifications`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Bearer | List notifications |
| PATCH | `/read-all` | Bearer | Mark all read |
| PATCH | `/:id/read` | Bearer | Mark one read |

### Admin — `/api/admin` (Bearer + Admin)

**Sitters** `/sitters`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List sitters |
| GET | `/:id` | Sitter detail |
| PATCH | `/:id/status` | Approve/reject |
| GET | `/:id/bookings` | Bookings list |
| GET | `/:id/bookings/:bookingId` | Booking detail |
| GET | `/:id/reviews` | Reviews |
| PATCH | `/:id/reviews/:reviewId` | Approve review |
| DELETE | `/:id/reviews/:reviewId` | Delete review |

**Owners** `/owners`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List owners |
| GET | `/:id` | Owner detail |
| PATCH | `/:id/ban` | Ban/unban |
| PATCH | `/:id/pets/:petId/suspend` | Suspend pet |

### Reports — `/api/reports`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | List reports |
| GET | `/:id` | — | Report detail |
| PATCH | `/:id/status` | — | Update status |

### Stripe webhook

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/webhooks/stripe` | Stripe signature | Payment events |

---

## 🔗 Integration with Frontend

| Item | Value |
|------|--------|
| Local API | `http://localhost:4000` |
| Production API | `https://pet-sitter-app-server.onrender.com` |
| FE env | `NEXT_PUBLIC_API_URL` → API base URL |
| CORS allowed | `localhost:3000`, `localhost:3001`, `https://pet-sitter-app-client-khaki.vercel.app` |

**Booking payment (Stripe TEST):** Phase 3 `POST /api/bookings` with `serviceType` returns `checkoutUrl` (Checkout Session). Legacy create (no `serviceType`) returns `clientSecret` (PaymentIntent, manual capture on sitter confirm). Webhook `POST /api/webhooks/stripe` verifies `Stripe-Signature` and marks the payment paid. Full request/response shapes: [`docs/phase3-api.md`](docs/phase3-api.md).

**GPS walks:** Walker `POST /api/sitters/bookings/:id/walk/{start,points,end}`. Owner live map: `GET /api/bookings/:id/walk/events` (SSE). History: `GET /api/bookings/:id/walk/points`. Why SSE instead of Supabase Realtime, plus Leaflet field names: [`docs/phase4-api.md`](docs/phase4-api.md).

---

## 📘 API Documentation (Swagger)

Interactive OpenAPI docs are served by Swagger UI at **`/api-docs`**.

Specs are generated from `@openapi` comments in `routes/*.mjs` (`swagger-jsdoc` + `swagger-ui-express`).

### Run locally

```bash
npm install
npm run dev

---

## 🚢 Deployment

**Platform:** [Render](https://render.com) — `pet-sitter-app-server.onrender.com`

1. Set all required [environment variables](#-environment-variables) on Render
2. Build command: `npm install`
3. Start command: `npm start` (binds `0.0.0.0:$PORT`)
4. Health check path: `/health`
5. **Stripe webhook:** `https://pet-sitter-app-server.onrender.com/api/webhooks/stripe`
6. **Supabase:** Add production FE URL to Auth redirect allow list
7. **`FRONTEND_URL`:** Production frontend origin (no trailing slash). Comma-separate extra origins if needed; localhost defaults stay allowed.

---

## 🧪 Testing

```bash
npm test
```

Runs unit/integration tests under `utils/`, `services/`, and `db/` (auth, OAuth, payout, bookings, service pricing, conflicts, status transitions, role checks, Stripe webhook signature, GPS walk authz/validation/distance/SSE, LISTEN_DATABASE_URL fallback, migration file order).

CI (GitHub Actions) also starts a Postgres 16 service and runs `db:migrate`, `db:seed`, and `db:verify`. That check does not use a live Supabase project.

---

## ⚠️ Known Limitations

- **`GET /api/reports`** — No admin auth yet (marked TODO in routes)
- **`GET /api/users`** — Public list endpoint (consider restricting in production)
- **Dual DB pool config** — `repositories/db.mjs` vs `utils/db.mjs` (both use `DATABASE_URL`)
- **LISTEN/NOTIFY** — requires a session connection. Set `LISTEN_DATABASE_URL` to the session pooler (5432) or a direct URI when `DATABASE_URL` is the Supabase transaction pooler (port 6543). In production, a missing or transaction-pooler `LISTEN_DATABASE_URL` fails at boot.

---

## 👥 Contributors

People who contributed to this repository.

| Name | GitHub | Contact |
|------|--------|---------|
| dimkungz | — | dimkungz@gmail.com |
| Pongsakorn Yuoeang | — | p.yuoeang@gmail.com |
| Kaopan | [Kaopan11](https://github.com/Kaopan11) | atkaew@gmail.com |
| Piradon | — | piradonleungamornnara@gmail.com |
| Natchanon | — | nutchanoon.yen@gmail.com |
| Bell Teerapat | — | wolfman13bell@gmail.com |
| pitnaree | [pitnarii](https://github.com/pitnarii) | pitnaree_@outlook.com |

---

## 📄 License

This project is licensed under the **ISC** License — see `package.json`.
