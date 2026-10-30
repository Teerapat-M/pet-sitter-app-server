import { httpError } from "./httpError.mjs";

export const SIGNAL_TYPES = ["offer", "answer", "ice"];
/** Cap on the signalling request body (UTF-8 bytes). Chromium A/V offers are ~6KB. */
export const MAX_SIGNAL_BYTES = 16384;
/** Full pg_notify JSON must stay under Postgres's 8000-byte payload limit. */
export const PG_NOTIFY_LIMIT_BYTES = 8000;
/** NOTIFY carries only a signal-ref id, well under this cap. */
export const MAX_NOTIFY_BYTES = 7000;
/** camera_signals rows older than this are deleted on insert and by the watch. */
export const SIGNAL_TTL_MS = 5 * 60 * 1000;
export const MAX_SIGNALS_PER_MINUTE = 40;
export const MAX_VIEWERS_PER_CAMERA = 8;
export const MAX_SESSIONS_PER_OWNER_PER_CAMERA = 2;

const windows = new Map();

export function resetCameraSignalRate() {
  windows.clear();
}

export function assertCameraSignalRate(key, now = Date.now()) {
  const slotKey = String(key);
  const slot = windows.get(slotKey);
  if (!slot || now - slot.start >= 60_000) {
    windows.set(slotKey, { start: now, count: 1 });
    return;
  }
  slot.count += 1;
  if (slot.count > MAX_SIGNALS_PER_MINUTE) {
    throw httpError(429, "Too many signalling messages");
  }
}

function asNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(400, `Invalid ${field}`);
  }
  return value;
}

export function utf8ByteLength(value) {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.byteLength(encoded, "utf8");
}

/** Reject payloads that would exceed the Postgres NOTIFY 8000-byte limit. */
export function assertNotifyPayloadSize(payload, { maxBytes = MAX_NOTIFY_BYTES } = {}) {
  const encoded = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw httpError(413, "Signalling payload is too large");
  }
  return encoded;
}

export function parseSignalBody(body, { maxBytes = MAX_SIGNAL_BYTES } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Signalling body is required");
  }
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw httpError(413, "Signalling payload is too large");
  }
  const type = String(body.type ?? body.kind ?? "").toLowerCase();
  if (!SIGNAL_TYPES.includes(type)) {
    throw httpError(400, "type must be offer, answer, or ice");
  }
  const sessionId = asNonEmptyString(body.sessionId ?? body.session_id, "sessionId");
  const payload = {
    type,
    sessionId,
  };
  if (type === "offer" || type === "answer") {
    payload.sdp = asNonEmptyString(body.sdp, "sdp");
  } else if (body.candidate == null || body.candidate === "") {
    throw httpError(400, "candidate is required");
  } else {
    payload.candidate = body.candidate;
  }
  return payload;
}
