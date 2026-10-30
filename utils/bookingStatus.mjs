import { httpError } from "./httpError.mjs";

export const BOOKING_STATUS = {
  WAITING_CONFIRM: "waiting_confirm",
  WAITING_SERVICE: "waiting_service",
  IN_SERVICE: "in_service",
  COMPLETED: "completed",
  SUCCESS: "success",
  CANCELLED: "cancelled",
};

/** Terminal "done" statuses. `success` is the pre-Phase-3 name for completed. */
export const COMPLETED_STATUSES = new Set([
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.SUCCESS,
]);

export const ACTIVE_BOOKING_STATUSES = [
  BOOKING_STATUS.WAITING_CONFIRM,
  BOOKING_STATUS.WAITING_SERVICE,
  BOOKING_STATUS.IN_SERVICE,
];

/** Sitter-driven transitions. Decline is waiting_confirm → cancelled. */
export const SITTER_TRANSITIONS = {
  waiting_confirm: ["waiting_service", "cancelled"],
  waiting_service: ["in_service"],
  in_service: ["completed", "success"],
};

export function isCompletedStatus(status) {
  return COMPLETED_STATUSES.has(status);
}

export function assertValidSitterTransition(from, to) {
  const allowed = SITTER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw httpError(400, "Invalid status transition");
  }
  return to === BOOKING_STATUS.SUCCESS ? BOOKING_STATUS.COMPLETED : to;
}

export function assertOwnerCanCancel(status) {
  if (status !== BOOKING_STATUS.WAITING_CONFIRM) {
    throw httpError(
      400,
      "Can only cancel a booking that is waiting for confirmation"
    );
  }
}

export function assertOwnerCanReschedule(status) {
  if (status !== BOOKING_STATUS.WAITING_CONFIRM) {
    throw httpError(
      400,
      "Can only change the date of a booking that is waiting for confirmation"
    );
  }
}

export function assertOwnerCanReview(status) {
  if (!isCompletedStatus(status)) {
    throw httpError(400, "Can only review a completed booking");
  }
}
