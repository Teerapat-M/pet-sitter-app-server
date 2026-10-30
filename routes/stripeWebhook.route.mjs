import { Router } from "express";
import { stripeWebhookController } from "../controllers/stripeWebhook.controller.mjs";

const stripeWebhookRouter = Router();

/**
 * @openapi
 * /api/webhooks/stripe:
 *   post:
 *     summary: Stripe TEST webhook (signature required)
 *     description: |
 *       Verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`.
 *       `checkout.session.completed` and `payment_intent.succeeded` mark the
 *       payment paid (booking stays waiting_confirm until the sitter accepts).
 *     tags: [Payments]
 *     parameters:
 *       - in: header
 *         name: Stripe-Signature
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: received
 *       400:
 *         description: Bad signature
 */
stripeWebhookRouter.post("/", stripeWebhookController.handle);

export default stripeWebhookRouter;
