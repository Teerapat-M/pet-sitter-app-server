import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Stripe from "stripe";
import { constructStripeEvent } from "../repositories/stripe.mjs";
import {
  createStripeWebhookService,
  paymentRefFromEvent,
} from "./stripeWebhook.service.mjs";

describe("paymentRefFromEvent", () => {
  it("reads PaymentIntent id and metadata bookingId", () => {
    assert.deepEqual(
      paymentRefFromEvent({
        type: "payment_intent.succeeded",
        data: {
          object: { id: "pi_123", metadata: { bookingId: "b1" } },
        },
      }),
      { paymentToken: "pi_123", bookingId: "b1" }
    );
  });

  it("reads Checkout Session payment_intent and client_reference_id", () => {
    assert.deepEqual(
      paymentRefFromEvent({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_123",
            payment_intent: "pi_abc",
            client_reference_id: "b1",
            metadata: {},
          },
        },
      }),
      { paymentToken: "pi_abc", bookingId: "b1" }
    );
  });
});

describe("stripe webhook signature", () => {
  it("accepts a Stripe test header and rejects a bad one", () => {
    process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

    const payload = JSON.stringify({
      id: "evt_test",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_test", metadata: { bookingId: "b1" } } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_test_secret",
    });

    const event = constructStripeEvent(Buffer.from(payload), header);
    assert.equal(event.type, "payment_intent.succeeded");
    assert.equal(event.data.object.id, "pi_test");

    assert.throws(
      () => constructStripeEvent(Buffer.from(payload), "t=1,v1=deadbeef"),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /signature/i);
        return true;
      }
    );

    assert.throws(
      () => constructStripeEvent(Buffer.from(payload), ""),
      (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });
});

describe("createStripeWebhookService", () => {
  it("marks payment paid on checkout.session.completed", async () => {
    const calls = [];
    const service = createStripeWebhookService({
      constructEvent: () => ({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1",
            payment_intent: "pi_1",
            metadata: { bookingId: "b1" },
          },
        },
      }),
      markPaid: async (args) => {
        calls.push(args);
        return { booking_id: "b1", status: "paid" };
      },
    });

    const result = await service.handleEvent("{}", "sig");
    assert.equal(result.matched, true);
    assert.equal(result.bookingId, "b1");
    assert.equal(result.paymentStatus, "paid");
    assert.equal(calls[0].paymentToken, "pi_1");
    assert.equal(calls[0].bookingId, "b1");
    assert.equal(calls[0].status, "paid");
  });

  it("marks payment failed on payment_intent.payment_failed", async () => {
    const service = createStripeWebhookService({
      constructEvent: () => ({
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_fail", metadata: { bookingId: "b1" } } },
      }),
      markPaid: async (args) => ({
        booking_id: args.bookingId,
        status: args.status,
      }),
    });
    const result = await service.handleEvent("{}", "sig");
    assert.equal(result.paymentStatus, "failed");
  });
});
