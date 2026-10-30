import { Router } from "express";
import { camerasController } from "../controllers/cameras.controller.mjs";
import { requireAuth } from "../middlewares/auth.middleware.mjs";

const iceRouter = Router();

/**
 * @openapi
 * /api/ice:
 *   get:
 *     summary: WebRTC ICE servers (Google STUN + gated TURN)
 *     description: |
 *       Requires `cameraId` (sitter of that camera) and/or `bookingId` (owner with
 *       an active grant). Disabled cameras are `403` (no TURN creds). TURN uses
 *       short-lived HMAC creds when `TURN_SECRET` is set.
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cameraId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: bookingId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: RTCPeerConnection iceServers
 *       400:
 *         description: cameraId or bookingId is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: No active grant / disabled camera / not this camera's sitter
 *       404:
 *         description: Camera or booking not found
 */
iceRouter.get("/", requireAuth, camerasController.ice);

export default iceRouter;
