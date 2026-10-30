import { httpError } from "./httpError.mjs";

export const SERVICE_TYPES = new Set(["boarding", "dog_walking", "in_home"]);
export const WALK_DURATIONS = new Set([30, 45, 60]);

function assertPositiveInt(value, message) {
  if (!Number.isInteger(value) || value < 1) {
    throw httpError(400, message);
  }
}

function assertUnitPrice(unitPrice) {
  const amount = Number(unitPrice);
  if (!Number.isFinite(amount) || amount < 0) {
    throw httpError(400, "Invalid service price");
  }
  return amount;
}

/** Boarding: nights × per-night rate (covers all pets on the booking). */
export function priceBoarding({ nights, unitPrice }) {
  assertPositiveInt(nights, "Invalid nights");
  return nights * assertUnitPrice(unitPrice);
}

/** Dog walking: one walk slot × per-walk (or 30/60 min) rate. */
export function priceDogWalking({ unitPrice }) {
  return assertUnitPrice(unitPrice);
}

/** In-home daytime visit: hours × hourly visit rate. */
export function priceInHomeVisit({ hours, unitPrice }) {
  assertPositiveInt(hours, "Invalid visit hours");
  return hours * assertUnitPrice(unitPrice);
}

/** In-home overnight: nights × overnight rate. */
export function priceInHomeOvernight({ nights, unitPrice }) {
  assertPositiveInt(nights, "Invalid nights");
  return nights * assertUnitPrice(unitPrice);
}

export function priceServiceOffering({ type, mode, nights, hours, unitPrice }) {
  if (type === "boarding") {
    return priceBoarding({ nights, unitPrice });
  }
  if (type === "dog_walking") {
    return priceDogWalking({ unitPrice });
  }
  if (type === "in_home" && mode === "overnight") {
    return priceInHomeOvernight({ nights, unitPrice });
  }
  if (type === "in_home" && mode === "visit") {
    return priceInHomeVisit({ hours, unitPrice });
  }
  throw httpError(400, "Unsupported service type");
}
