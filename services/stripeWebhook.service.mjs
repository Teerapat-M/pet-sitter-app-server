import { bookingsRepository } from "../repositories/bookings.repository.mjs";
import { constructStripeEvent } from "../repositories/stripe.mjs";
import { httpError } from "../utils/httpError.mjs";

const PAID_TYPES = new Set([
  "payment_intent.succeeded",
  "checkout.session.completed",
]);
const FAILED_TYPES = new Set([
  "payment_intent.payment_failed",
  "checkout.session.expired",
  "checkout.session.async_payment_failed",
]);

export function paymentRefFromEvent(event) {
  const object = event?.data?.object ?? {};
  if (String(event?.type ?? "").startsWith("checkout.session")) {
    return {
      paymentToken: object.payment_intent || object.id || null,
      bookingId: object.metadata?.bookingId || object.client_reference_id || null,
    };
  }
  return {
    paymentToken: object.id || null,
    bookingId: object.metadata?.bookingId || null,
  };
}

export function createStripeWebhookService({
  constructEvent = constructStripeEvent,
  markPaid = (args) => bookingsRepository.markPaymentPaidByTokenOrBooking(args),
} = {}) {
  return {
    async handleEvent(rawBody, signature) {
      const event = constructEvent(rawBody, signature);

      if (!PAID_TYPES.has(event.type) && !FAILED_TYPES.has(event.type)) {
        return { received: true, ignored: true, type: event.type };
      }

      const { paymentToken, bookingId } = paymentRefFromEvent(event);
      if (!paymentToken && !bookingId) {
        throw httpError(400, "Payment reference missing");
      }

      const nextStatus = PAID_TYPES.has(event.type) ? "paid" : "failed";
      const paidAt =
        nextStatus === "paid" ? new Date().toISOString() : null;

      const updated = await markPaid({
        paymentToken,
        bookingId,
        status: nextStatus,
        paidAt,
      });

      if (!updated) {
        return { received: true, matched: false, type: event.type };
      }

      return {
        received: true,
        matched: true,
        type: event.type,
        bookingId: updated.booking_id,
        paymentStatus: updated.status,
      };
    },
  };
}

export const stripeWebhookService = createStripeWebhookService();
