import { Router } from "express";
import multer from "multer";
import { chatController } from "../controllers/chat.controller.mjs";
import { requireAuth } from "../middlewares/auth.middleware.mjs";

const chatRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (
      !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
        file.mimetype
      )
    ) {
      callback(new Error("Image must be JPG, PNG, or WebP"));
      return;
    }
    callback(null, true);
  },
});

function uploadChatImage(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image must be 2MB or smaller"
        : error.message;
    return res.status(400).json({ message });
  });
}

chatRouter.use(requireAuth);

chatRouter.post("/", chatController.createConversation);

/**
 * @openapi
 * /api/conversations:
 *   get:
 *     summary: List my conversations
 *     description: |
 *       Each thread includes bookingId and a booking summary (null if unlinked),
 *       otherUser.lastSeenAt / isOnline, and otherUser.phone only when the viewer
 *       has a confirmed (`waiting_service`) or in-service booking with that user.
 *       Dates are `{ date, startTime, endTime }` for same-day bookings, otherwise
 *       `{ start, end, startTime, endTime }`. isOnline is true when the other user
 *       has an open SSE connection or lastSeenAt is within two minutes.
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Conversation list with booking summary and presence
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       ownerId: { type: string, format: uuid }
 *                       sitterId: { type: string, format: uuid }
 *                       createdAt: { type: string, format: date-time }
 *                       bookingId:
 *                         type: string
 *                         format: uuid
 *                         nullable: true
 *                       booking:
 *                         nullable: true
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           service_name: { type: string, nullable: true }
 *                           dates: { type: object, nullable: true }
 *                           pets:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 id: { type: integer }
 *                                 name: { type: string }
 *                           status: { type: string, nullable: true }
 *                           transactionNo: { type: string, nullable: true }
 *                       otherUser:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                           avatarUrl: { type: string, nullable: true }
 *                           phone:
 *                             type: string
 *                             nullable: true
 *                             description: Present only for waiting_service / in_service bookings
 *                           lastSeenAt: { type: string, format: date-time, nullable: true }
 *                           isOnline: { type: boolean }
 *                       lastMessage: { type: string }
 *                       lastSentAt: { type: string, format: date-time, nullable: true }
 *                       unreadCount: { type: integer }
 *       401:
 *         description: Unauthorized
 */
chatRouter.get("/", chatController.listConversations);

/**
 * @openapi
 * /api/conversations/events:
 *   get:
 *     summary: Subscribe to chat events (SSE)
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Server-sent events stream
 *       401:
 *         description: Unauthorized
 */
chatRouter.get("/events", chatController.streamEvents);
chatRouter.get("/:id/messages", chatController.listMessages);
chatRouter.post("/:id/messages", uploadChatImage, chatController.sendMessage);
chatRouter.post("/:id/read", chatController.markConversationRead);

export default chatRouter;
