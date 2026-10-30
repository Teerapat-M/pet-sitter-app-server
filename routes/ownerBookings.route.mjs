import { Router } from "express";
import { bookingsController } from "../controllers/bookings.controller.mjs";
import { walksController } from "../controllers/walks.controller.mjs";
import { camerasController } from "../controllers/cameras.controller.mjs";
import { requireAuth } from "../middlewares/auth.middleware.mjs";

const ownerBookingsRouter = Router();

/**
 * @openapi
 * /api/bookings/owner:
 *   get:
 *     summary: Get my bookings as owner
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           example: waiting_confirm
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Owner booking list
 *       401:
 *         description: Unauthorized
 */
ownerBookingsRouter.get(
  "/owner",
  requireAuth,
  bookingsController.getOwnerBookings
);
// GET /api/bookings/owner/:id — รายละเอียด booking รายการเดียว (สำหรับหน้า detail/drawer)
ownerBookingsRouter.get(
  "/owner/:id",
  requireAuth,
  bookingsController.getOwnerBookingById
);
// POST /api/bookings/owner/:id/cancel — ยกเลิก booking (ได้เฉพาะตอนยัง waiting_confirm)
ownerBookingsRouter.post(
  "/owner/:id/cancel",
  requireAuth,
  bookingsController.cancelOwnerBooking
);
// POST /api/bookings/owner/:id/reschedule — เลื่อนวัน/เวลา booking (ได้เฉพาะตอนยัง waiting_confirm)
ownerBookingsRouter.post(
  "/owner/:id/reschedule",
  requireAuth,
  bookingsController.rescheduleOwnerBooking
);
// POST /api/bookings/owner/:id/review — ให้คะแนน/เขียนรีวิว booking ที่เสร็จแล้ว (success)
ownerBookingsRouter.post(
  "/owner/:id/review",
  requireAuth,
  bookingsController.submitOwnerReview
);
// POST /api/bookings/owner/:id/report — แจ้งปัญหาเกี่ยวกับ booking นี้
ownerBookingsRouter.post(
  "/owner/:id/report",
  requireAuth,
  bookingsController.submitOwnerReport
);

/**
 * @openapi
 * /api/bookings/quote:
 *   post:
 *     summary: Server-side price quote (client totalPrice is ignored)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BookingQuoteRequest'
 *     responses:
 *       200:
 *         description: Quote with unit price, quantity, totalPrice, available, hasCctv
 *       400:
 *         description: Validation error
 *       404:
 *         description: Sitter or offering not found
 */
ownerBookingsRouter.post("/quote", requireAuth, bookingsController.quote);

/**
 * @openapi
 * /api/bookings/{id}/checkout:
 *   post:
 *     summary: Create a Stripe TEST Checkout Session for an unpaid booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: checkoutUrl + checkoutSessionId
 *       400:
 *         description: Not a payable Stripe booking
 *       404:
 *         description: Booking not found
 */
ownerBookingsRouter.post(
  "/:id/checkout",
  requireAuth,
  bookingsController.checkout
);

/**
 * @openapi
 * /api/bookings/{id}/walk:
 *   get:
 *     summary: Current walk + summary (owner or sitter)
 *     tags: [Walks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Walk or null if not started
 *       404:
 *         description: Booking not found
 */
ownerBookingsRouter.get("/:id/walk", requireAuth, walksController.getWalk);

/**
 * @openapi
 * /api/bookings/{id}/walk/points:
 *   get:
 *     summary: Walk route history + summary
 *     tags: [Walks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: afterId
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 2000 }
 *     responses:
 *       200:
 *         description: Points in recordedAt order plus summary
 *       404:
 *         description: Booking or walk not found
 */
ownerBookingsRouter.get(
  "/:id/walk/points",
  requireAuth,
  walksController.listPoints
);

/**
 * @openapi
 * /api/bookings/{id}/walk/events:
 *   get:
 *     summary: Live GPS trail (SSE)
 *     description: |
 *       Same Bearer SSE pattern as `GET /api/conversations/events`.
 *       Snapshot first (`waiting` | `live` | `ended`), then `point` / `started` / `ended`.
 *       Leaflet + OSM should plot `lat`/`lng` from each `point` event.
 *     tags: [Walks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Server-sent events stream
 *       404:
 *         description: Booking not found
 */
ownerBookingsRouter.get(
  "/:id/walk/events",
  requireAuth,
  walksController.streamWalk
);

/**
 * @openapi
 * /api/bookings/{id}/cameras:
 *   get:
 *     summary: Cameras + status + access window for an in-service boarding booking
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Cameras and access window
 *       403:
 *         description: Owner outside window, not in_service, or not boarding
 *       404:
 *         description: Booking not found
 */
ownerBookingsRouter.get(
  "/:id/cameras",
  requireAuth,
  camerasController.listForBooking
);

/**
 * @openapi
 * /api/bookings/{id}/cameras/events:
 *   get:
 *     summary: SSE camera:status and WebRTC signalling for this booking
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Server-sent events stream
 *       403:
 *         description: Live view not allowed
 *       404:
 *         description: Booking not found
 */
ownerBookingsRouter.get(
  "/:id/cameras/events",
  requireAuth,
  camerasController.streamBooking
);

/**
 * @openapi
 * /api/bookings/{id}/cameras/{cameraId}/signal:
 *   post:
 *     summary: Relay a WebRTC offer or ICE candidate from the owner viewer
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CameraSignal'
 *     responses:
 *       200:
 *         description: Relayed (not stored)
 *       403:
 *         description: Disabled camera, outside window, or not boarding
 *       404:
 *         description: Booking not found
 */
ownerBookingsRouter.post(
  "/:id/cameras/:cameraId/signal",
  requireAuth,
  camerasController.viewerSignal
);

/**
 * @openapi
 * /api/bookings:
 *   post:
 *     summary: Create a booking (cash or stripe). Phase 3 sends serviceType.
 *     description: |
 *       Server recomputes price from `services`. `totalPrice` in the body is ignored.
 *       Stripe service bookings return `checkoutUrl`. Legacy (no serviceType) still
 *       returns PaymentIntent `clientSecret`. On create, a conversation is linked
 *       (`conversation.booking_id`) after owner/sitter pair validation.
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBookingRequest'
 *     responses:
 *       201:
 *         description: Booking created (waiting_confirm)
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Time slot already booked
 */
ownerBookingsRouter.post("/", requireAuth, bookingsController.create);

export default ownerBookingsRouter;
