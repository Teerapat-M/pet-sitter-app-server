import { httpError } from "./httpError.mjs";
import {
  isBookingOwner,
  isBookingParty,
  isBookingSitter,
} from "./bookingAuth.mjs";

export function isBoardingBooking(booking) {
  const type = String(booking?.service_type ?? booking?.serviceType ?? "");
  if (type === "boarding") return true;
  const unit = String(booking?.duration_unit ?? booking?.durationUnit ?? "");
  return unit === "nights" || unit === "Day";
}

export function grantCoversAt(grant, at = new Date()) {
  if (!grant) return false;
  const from = new Date(grant.valid_from ?? grant.validFrom ?? 0);
  const to = new Date(grant.valid_to ?? grant.validTo ?? 0);
  const time = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || Number.isNaN(time.getTime())) {
    return false;
  }
  return time >= from && time <= to;
}

/** Strangers 404; known owner of a non-viewable booking 403. */
export function assertOwnerLiveView(booking, userId, { grant, now } = {}) {
  if (!booking || !isBookingOwner(booking, userId)) {
    throw httpError(404, "Booking not found");
  }
  if (!isBoardingBooking(booking)) {
    throw httpError(403, "Live view is only available for boarding bookings");
  }
  if (String(booking.status) !== "in_service") {
    throw httpError(
      403,
      "Live view is only available while the booking is in service"
    );
  }
  if (grant !== undefined && !grantCoversAt(grant, now)) {
    throw httpError(403, "Live view is outside the camera access window");
  }
}

export function assertBookingCameraParty(booking, userId) {
  if (!booking || !isBookingParty(booking, userId)) {
    throw httpError(404, "Booking not found");
  }
}

export function assertSitterCamera(camera, userId) {
  if (!camera || String(camera.sitter_id ?? camera.sitterId) !== String(userId)) {
    throw httpError(404, "Camera not found");
  }
}

export function assertCameraEnabled(camera) {
  if (!camera) {
    throw httpError(404, "Camera not found");
  }
  if (camera.is_enabled === false || camera.isEnabled === false) {
    throw httpError(403, "This camera is disabled");
  }
}

function asVenueId(value) {
  if (value == null || value === "") return null;
  return String(value);
}

export function cameraVenueId(camera) {
  return asVenueId(camera?.venue_id ?? camera?.venueId);
}

export function bookingVenueId(booking) {
  return asVenueId(booking?.venue_id ?? booking?.venueId);
}

/** Null venue is the sitter's default home. Both must match. */
export function cameraMatchesBookingVenue(camera, booking) {
  return cameraVenueId(camera) === bookingVenueId(booking);
}

export function assertCameraMatchesBookingVenue(camera, booking) {
  if (!cameraMatchesBookingVenue(camera, booking)) {
    throw httpError(403, "Camera is not at this booking's venue");
  }
}

export function viewerOrSitterRole(booking, userId) {
  if (!booking) {
    throw httpError(404, "Booking not found");
  }
  if (isBookingSitter(booking, userId)) return "sitter";
  if (isBookingOwner(booking, userId)) return "owner";
  throw httpError(404, "Booking not found");
}
