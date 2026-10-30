import { Router } from "express";
import { camerasController } from "../controllers/cameras.controller.mjs";
import { requireAuth, requireSitter } from "../middlewares/auth.middleware.mjs";

const sitterCamerasRouter = Router();

/**
 * @openapi
 * /api/sitters/cameras:
 *   get:
 *     summary: List cameras for the logged-in sitter
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Camera list with status
 *       403:
 *         description: Not a sitter
 *   post:
 *     summary: Register a camera at the venue
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               venueId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201:
 *         description: Camera created
 */
sitterCamerasRouter.get("/", requireAuth, requireSitter, camerasController.listMine);
sitterCamerasRouter.post("/", requireAuth, requireSitter, camerasController.create);

/**
 * @openapi
 * /api/sitters/cameras/events:
 *   get:
 *     summary: SSE for the sitter's cameras (status + WebRTC signalling)
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Server-sent events stream
 */
sitterCamerasRouter.get(
  "/events",
  requireAuth,
  requireSitter,
  camerasController.streamSitter
);

/**
 * @openapi
 * /api/sitters/cameras/{id}:
 *   get:
 *     summary: Get one of my cameras
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
 *         description: Camera
 *       404:
 *         description: Camera not found
 *   patch:
 *     summary: Enable or disable a camera (and optionally rename)
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isEnabled: { type: boolean }
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Camera updated; disabling ends live sessions
 *       403:
 *         description: Not a sitter
 *       404:
 *         description: Camera not found
 *   delete:
 *     summary: Remove a camera
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
 *         description: Deleted
 */
sitterCamerasRouter.get("/:id", requireAuth, requireSitter, camerasController.getMine);
sitterCamerasRouter.patch("/:id", requireAuth, requireSitter, camerasController.update);
sitterCamerasRouter.delete("/:id", requireAuth, requireSitter, camerasController.remove);

/**
 * @openapi
 * /api/sitters/cameras/{id}/heartbeat:
 *   post:
 *     summary: Publisher heartbeat — marks the camera online
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
 *         description: Camera lastSeenAt updated
 */
sitterCamerasRouter.post(
  "/:id/heartbeat",
  requireAuth,
  requireSitter,
  camerasController.heartbeat
);

/**
 * @openapi
 * /api/sitters/cameras/{id}/signal:
 *   post:
 *     summary: Relay a WebRTC answer or ICE candidate from the publisher
 *     tags: [Cameras]
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
 *             $ref: '#/components/schemas/CameraSignal'
 *     responses:
 *       200:
 *         description: Relayed (not stored)
 *       413:
 *         description: Payload too large
 *       429:
 *         description: Rate limited
 */
sitterCamerasRouter.post(
  "/:id/signal",
  requireAuth,
  requireSitter,
  camerasController.publisherSignal
);

export default sitterCamerasRouter;
