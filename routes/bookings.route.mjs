import { Router } from "express";
import { bookingsController } from "../controllers/bookings.controller.mjs";
import { requireAuth, requireSitter } from "../middlewares/auth.middleware.mjs";

const bookingsRouter = Router();

/**
 * @openapi
 * /api/sitters/bookings:
 *   get:
 *     summary: List bookings for the logged-in sitter
 *     tags: [Sitter Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [waiting_confirm, waiting_service, in_service, completed, cancelled, all]
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 7 }
 *     responses:
 *       200:
 *         description: Sitter booking list
 *       403:
 *         description: Not a sitter
 */
bookingsRouter.get("/", requireAuth, requireSitter, bookingsController.getMyBookings);

/**
 * @openapi
 * /api/sitters/bookings/{id}:
 *   get:
 *     summary: Sitter booking detail (404 for owner/other)
 *     tags: [Sitter Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Booking detail including serviceType, hasCctv, ownerAddress
 *       404:
 *         description: Booking not found
 */
bookingsRouter.get("/:id", requireAuth, requireSitter, bookingsController.getMyBookingById);

/**
 * @openapi
 * /api/sitters/bookings/{id}/accept:
 *   post:
 *     summary: Sitter accepts a waiting_confirm booking → waiting_service
 *     tags: [Sitter Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Accepted
 *       400:
 *         description: Invalid transition
 *       404:
 *         description: Booking not found
 */
bookingsRouter.post(
  "/:id/accept",
  requireAuth,
  requireSitter,
  bookingsController.acceptMyBooking
);

/**
 * @openapi
 * /api/sitters/bookings/{id}/decline:
 *   post:
 *     summary: Sitter declines a waiting_confirm booking → cancelled
 *     tags: [Sitter Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Declined
 *       400:
 *         description: Invalid transition
 *       404:
 *         description: Booking not found
 */
bookingsRouter.post(
  "/:id/decline",
  requireAuth,
  requireSitter,
  bookingsController.declineMyBooking
);

/**
 * @openapi
 * /api/sitters/bookings/{id}/status:
 *   patch:
 *     summary: Sitter status transition
 *     description: |
 *       Allowed: waiting_confirm→waiting_service|cancelled,
 *       waiting_service→in_service, in_service→completed (legacy `success` maps to completed).
 *     tags: [Sitter Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [waiting_service, in_service, completed, cancelled]
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid transition
 */
bookingsRouter.patch(
  "/:id/status",
  requireAuth,
  requireSitter,
  bookingsController.updateMyBookingStatus
);

export default bookingsRouter;
