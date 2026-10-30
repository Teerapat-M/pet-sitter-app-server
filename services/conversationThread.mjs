import { isOnline } from "../utils/presence.mjs";

/** Phone is shared only while a booking with the other user is confirmed or in service. */
export const PHONE_VISIBLE_STATUSES = new Set(["waiting_service", "in_service"]);

export function canSeeOtherUserPhone(bookingStatus) {
  return PHONE_VISIBLE_STATUSES.has(bookingStatus);
}

export function serviceDisplayName(type, mode) {
  if (type === "boarding") return "Boarding";
  if (type === "dog_walking") return "Dog walking";
  if (type === "in_home") {
    if (mode === "overnight") return "In-home overnight";
    if (mode === "visit") return "In-home visit";
    return "In-home";
  }
  return type ?? null;
}

function asDateString(value) {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function asTimeString(value) {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 5);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(11, 16);
  }
  return String(value);
}

export function bookingDates({ startDate, endDate, startTime, endTime }) {
  const start = asDateString(startDate);
  const end = asDateString(endDate);
  const startT = asTimeString(startTime);
  const endT = asTimeString(endTime);
  if (!start) return null;
  if (!end || start === end) {
    return { date: start, startTime: startT, endTime: endT };
  }
  return { start, end, startTime: startT, endTime: endT };
}

function previewText(row) {
  const content = String(row.last_message ?? "").trim();
  if (content) return content;
  if (row.last_image_url) return "Sent a photo";
  return "";
}

function parsePets(value) {
  if (value == null) return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

/** True when the booking's owner/sitter is the conversation pair. */
export function bookingPairMatches(booking, ownerId, sitterId) {
  return Boolean(
    booking &&
      booking.owner_id === ownerId &&
      booking.sitter_id === sitterId
  );
}

/** Persist booking_id only when it belongs to this owner/sitter pair. */
export function resolveLinkedBookingId(booking, ownerId, sitterId) {
  if (!bookingPairMatches(booking, ownerId, sitterId)) return null;
  return booking.id ?? null;
}

export function toBookingSummary(row) {
  const bookingId = resolveLinkedBookingId(
    {
      id: row.booking_id,
      owner_id: row.booking_owner_id,
      sitter_id: row.booking_sitter_id,
    },
    row.owner_id,
    row.sitter_id
  );
  if (!bookingId) return null;
  return {
    id: bookingId,
    service_name: serviceDisplayName(row.service_type, row.service_mode),
    dates: bookingDates({
      startDate: row.start_date,
      endDate: row.end_date,
      startTime: row.start_time,
      endTime: row.end_time,
    }),
    pets: parsePets(row.pets),
    status: row.booking_status ?? null,
    transactionNo: row.booking_transaction_no ?? null,
  };
}

export function toConversationThread(row, { sseConnected = false, now } = {}) {
  const booking = toBookingSummary(row);
  const lastSeenAt = row.other_last_seen_at ?? null;
  const showPhone = canSeeOtherUserPhone(booking?.status);
  return {
    id: String(row.id),
    ownerId: row.owner_id,
    sitterId: row.sitter_id,
    createdAt: row.created_at,
    bookingId: booking?.id ?? null,
    booking,
    otherUser: {
      id: row.other_user_id,
      name: row.other_name || "User",
      avatarUrl: row.other_avatar_url ?? null,
      phone: showPhone ? row.other_phone ?? null : null,
      lastSeenAt,
      isOnline: isOnline({ lastSeenAt, sseConnected, now }),
    },
    lastMessage: previewText(row),
    lastSentAt: row.last_sent_at ?? null,
    unreadCount: row.unread_count ?? 0,
  };
}
