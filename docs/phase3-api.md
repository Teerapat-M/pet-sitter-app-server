# Phase 3 API contract

Client build target for boarding, dog walking, and in-home bookings.
Auth: `Authorization: Bearer <access_token>` unless noted.
Base: `/api`. Money is THB. Server always recomputes `totalPrice` from `services`; a client total is ignored.

Status lifecycle (enforced):

```
waiting_confirm → waiting_service → in_service → completed
                ↘ cancelled
```

`success` is a legacy alias of `completed` (still stored on old rows; sitter `PATCH …/status` with `success` is stored as `completed`).

---

## Sitter public profile

`GET /api/sitters/:id`

Adds:

- `hasCctv` (boolean) — sitter has ≥1 enabled camera
- `serviceOfferings[]` — `{ id, type, mode, durationMinutes, priceAmount, currency }`

`GET /api/sitters` cards also return `hasCctv` and `fromPrice` (min active offering).

`GET /api/sitters/:id/availability` — busy slots `{ startDate, endDate, startTime, endTime }` for active bookings.

---

## Quote

`POST /api/bookings/quote`

Shared fields: `sitterId`, `serviceType` (`boarding` | `dog_walking` | `in_home`), `petIds?`, `totalPrice?` (ignored).

### Boarding

```json
{ "sitterId": "uuid", "serviceType": "boarding", "checkIn": "2026-11-01", "checkOut": "2026-11-05", "petIds": [1, 2] }
```

Check-in/out default to 12:00. Price = nights × offering `price_amount`. `hasCctv` is true when the venue has an enabled camera.

### Dog walking (dogs only)

```json
{ "sitterId": "uuid", "serviceType": "dog_walking", "mode": "duration", "date": "2026-11-02", "startTime": "09:00", "durationMinutes": 30, "petIds": [1] }
```

`mode`: `per_walk` | `duration`. Duration walks: `durationMinutes` 30, 45, or 60. Per-walk uses a 60-minute conflict window unless `durationMinutes` is sent. Price = offering amount (one walk).

### In-home

Visit:

```json
{ "sitterId": "uuid", "serviceType": "in_home", "mode": "visit", "date": "2026-11-02", "startTime": "13:00", "visitHours": 2, "petIds": [3] }
```

Overnight:

```json
{ "sitterId": "uuid", "serviceType": "in_home", "mode": "overnight", "checkIn": "2026-11-02", "checkOut": "2026-11-04", "petIds": [3] }
```

Visit price = hours × offering. Overnight = nights × offering.

### Quote response `200 { data }`

```json
{
  "serviceId": "uuid",
  "serviceType": "boarding",
  "mode": null,
  "durationMinutes": null,
  "startDate": "2026-11-01",
  "endDate": "2026-11-05",
  "startTime": "12:00",
  "endTime": "12:00",
  "duration": 4,
  "durationUnit": "nights",
  "nights": 4,
  "hours": null,
  "petCount": 2,
  "unitPrice": 1200,
  "currency": "THB",
  "totalPrice": 4800,
  "hasCctv": true,
  "quantity": 4,
  "available": true
}
```

`available: false` when the slot overlaps an active booking (`waiting_confirm` | `waiting_service` | `in_service`). Create still re-checks inside a transaction (`SELECT … FOR UPDATE`).

Errors: `400` validation, `404` sitter/offering missing.

---

## Create booking

`POST /api/bookings`

Same body as quote plus `paymentMethod` (`cash` | `stripe`), `message?`. In-home requires `ownerAddress`; `accessInstructions` optional.

Creates `waiting_confirm`, inserts pets + pending payment, links or creates the owner/sitter conversation and sets `conversations.booking_id` only when `bookings.owner_id` / `sitter_id` match that pair.

### Cash response `201 { data }`

```json
{
  "bookingId": "uuid",
  "status": "waiting_confirm",
  "totalPrice": 4800,
  "transactionNo": "TX-20261030-0005",
  "paymentStatus": "pending",
  "serviceId": "uuid",
  "serviceType": "boarding",
  "mode": null,
  "hasCctv": true,
  "conversationId": "1"
}
```

### Stripe (Phase 3 `serviceType`) `201 { data }`

Same plus:

```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_…",
  "checkoutSessionId": "cs_test_…"
}
```

TEST-mode Checkout Session. Keys from `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` only.

Legacy create (no `serviceType`) still returns PaymentIntent `clientSecret` (manual capture on sitter accept).

`409` overlapping slot. `400` dogs-only / missing address / incomplete profile / self-book.

---

## Checkout (existing unpaid Stripe booking)

`POST /api/bookings/:id/checkout` (owner)

`200 { data: { bookingId, checkoutUrl, checkoutSessionId } }`

---

## Stripe webhook

`POST /api/webhooks/stripe`  
Header: `Stripe-Signature`. Raw JSON body.

Handled:

- `checkout.session.completed`, `payment_intent.succeeded` → `payments.status = paid`
- `payment_intent.payment_failed`, `checkout.session.expired`, `checkout.session.async_payment_failed` → `failed`

Payment success records paid. Booking status stays `waiting_confirm` until the sitter accepts (`waiting_service`). Bad signature → `400`.

---

## Owner bookings

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/bookings/owner` | List. Query: `search`, `status`, `page`, `limit` |
| GET | `/api/bookings/owner/:id` | Detail. Includes `service_type`, `has_cctv`, `owner_address` |
| POST | `/api/bookings/owner/:id/cancel` | Only `waiting_confirm` |
| POST | `/api/bookings/owner/:id/reschedule` | Only `waiting_confirm`; Stripe price must stay the same |
| POST | `/api/bookings/owner/:id/review` | `completed` or legacy `success` |
| POST | `/api/bookings/owner/:id/report` | `{ subject, description? }` |

Owner-only: sitter/other → `404`.

List/detail extra fields: `service_id`, `service_type`, `service_mode`. Detail also `has_cctv`, `owner_address`, `access_instructions`.

---

## Sitter bookings

Sitter-only (`requireSitter`). Owner/other → `403` (not a sitter) or `404` (wrong sitter).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/sitters/bookings` | List |
| GET | `/api/sitters/bookings/:id` | Detail + `has_cctv` + `owner_address` |
| POST | `/api/sitters/bookings/:id/accept` | `waiting_confirm` → `waiting_service` |
| POST | `/api/sitters/bookings/:id/decline` | `waiting_confirm` → `cancelled` |
| PATCH | `/api/sitters/bookings/:id/status` | `{ status }` |

Allowed `PATCH` transitions:

- `waiting_confirm` → `waiting_service` \| `cancelled`
- `waiting_service` → `in_service`
- `in_service` → `completed` (or `success` → stored as `completed`)

Invalid → `400 Invalid status transition`.

Accept captures an uncaptured PaymentIntent. Decline/cancel cancels it, or refunds if Checkout already captured.

---

## Conflicts

Active bookings for a sitter cannot overlap in datetime. Create runs `SELECT … FOR UPDATE` then the overlap predicate in one transaction. Checkout day of a many-day stay is free (range `[start, end)`). Same-day walks/visits overlap on the time window.

---

## Conversation

On create: find conversation for `(owner_id, sitter_id)` or insert one; `booking_id` is set only if that booking’s owner and sitter match the pair. `GET /api/conversations` already returns the linked booking summary.
