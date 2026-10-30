import { httpError } from "./httpError.mjs";

export function isBookingOwner(booking, userId) {
  return Boolean(booking && String(booking.owner_id) === String(userId));
}

export function isBookingSitter(booking, userId) {
  return Boolean(booking && String(booking.sitter_id) === String(userId));
}

export function isBookingParty(booking, userId) {
  return isBookingOwner(booking, userId) || isBookingSitter(booking, userId);
}

/** Owner endpoints hide existence from everyone else. */
export function assertOwnerAccess(booking, userId) {
  if (!booking || !isBookingOwner(booking, userId)) {
    throw httpError(404, "Booking not found");
  }
}

/** Sitter endpoints hide existence from everyone else. */
export function assertSitterAccess(booking, userId) {
  if (!booking || !isBookingSitter(booking, userId)) {
    throw httpError(404, "Booking not found");
  }
}

export function assertPartyAccess(booking, userId) {
  if (!booking || !isBookingParty(booking, userId)) {
    throw httpError(404, "Booking not found");
  }
}

export function assertNotSelfBooking(ownerId, sitterId) {
  if (String(ownerId) === String(sitterId)) {
    throw httpError(400, "You cannot book yourself");
  }
}
