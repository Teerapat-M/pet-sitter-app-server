import { Router } from "express";
import { camerasController } from "../controllers/cameras.controller.mjs";
import { requireAuth } from "../middlewares/auth.middleware.mjs";

const iceRouter = Router();

/**
 * @openapi
 * /api/ice:
 *   get:
 *     summary: WebRTC ICE servers (Google STUN + optional TURN from env)
 *     tags: [Cameras]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: RTCPeerConnection iceServers
 *       401:
 *         description: Unauthorized
 */
iceRouter.get("/", requireAuth, camerasController.ice);

export default iceRouter;
