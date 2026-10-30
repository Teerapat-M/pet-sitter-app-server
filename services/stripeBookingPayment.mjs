import { bookingsRepository } from "../repositories/bookings.repository.mjs";
import { getStripe } from "../repositories/stripe.mjs";
import { httpError } from "../utils/httpError.mjs";
import { toStripeAmount } from "../utils/stripeAmount.mjs";
import { parseFrontendOrigins } from "../utils/corsOrigins.mjs";

const defaultDeps = {
  capture: (paymentToken) => getStripe().paymentIntents.capture(paymentToken),
  cancel: (paymentToken) => getStripe().paymentIntents.cancel(paymentToken),
  updatePaymentStatus: (paymentToken, status, paidAt) =>
    bookingsRepository.updatePaymentStatusByToken(paymentToken, status, paidAt),
};

/** T03 — capture หลัง owner authorize · mark paid ทันที (webhook ยังทำงานซ้ำได้) */
export async function captureStripePaymentIntent(paymentToken, deps = defaultDeps) {
  if (!paymentToken) {
    throw httpError(400, "Stripe payment is not ready for capture");
  }

  const intent = await deps.capture(paymentToken);
  if (intent.status !== "succeeded") {
    throw httpError(402, "Payment capture was not completed");
  }

  await deps.updatePaymentStatus(
    paymentToken,
    "paid",
    new Date().toISOString()
  );
}

/** T03 — ยกเลิก PI ที่ยังไม่ capture */
export async function cancelStripePaymentIntent(paymentToken, deps = defaultDeps) {
  if (!paymentToken || String(paymentToken).startsWith("cs_")) {
    return;
  }

  try {
    await deps.cancel(paymentToken);
  } catch (error) {
    const code = error?.code ?? error?.raw?.code;
    if (
      code === "payment_intent_unexpected_state" ||
      code === "resource_missing"
    ) {
      return;
    }
    throw httpError(402, error.message || "Failed to cancel Stripe payment");
  }
}

export function checkoutUrls(bookingId, frontendUrl = process.env.FRONTEND_URL) {
  const [origin] = parseFrontendOrigins(frontendUrl);
  const base = origin || "http://localhost:3000";
  return {
    successUrl: `${base}/owner/bookings?checkout=success&bookingId=${bookingId}`,
    cancelUrl: `${base}/owner/bookings?checkout=cancel&bookingId=${bookingId}`,
  };
}

export async function createCheckoutSession({
  bookingId,
  amount,
  successUrl,
  cancelUrl,
}) {
  const urls = checkoutUrls(bookingId);
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    success_url: successUrl || urls.successUrl,
    cancel_url: cancelUrl || urls.cancelUrl,
    client_reference_id: String(bookingId),
    metadata: { bookingId: String(bookingId) },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "thb",
          unit_amount: toStripeAmount(amount),
          product_data: { name: "Pet sitter booking" },
        },
      },
    ],
  });
  return session;
}

/** Checkout is already captured — refund on decline/cancel. PI cancel is a no-op then. */
export async function refundStripePaymentIfCaptured(paymentToken) {
  if (!paymentToken || String(paymentToken).startsWith("cs_")) {
    return;
  }
  try {
    await getStripe().refunds.create({ payment_intent: paymentToken });
  } catch (error) {
    const code = error?.code ?? error?.raw?.code;
    if (code === "resource_missing" || code === "charge_already_refunded") {
      return;
    }
    throw httpError(402, error.message || "Failed to refund Stripe payment");
  }
}
