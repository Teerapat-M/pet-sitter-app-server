/** Treat a user as online if last_seen_at is within this window (or SSE is connected). */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const TOUCH_INTERVAL_MS = 15 * 1000;
const lastTouchMs = new Map();

export function isOnline({ lastSeenAt, sseConnected = false, now = Date.now() }) {
  if (sseConnected) return true;
  if (!lastSeenAt) return false;
  const t =
    lastSeenAt instanceof Date ? lastSeenAt.getTime() : Date.parse(lastSeenAt);
  if (Number.isNaN(t)) return false;
  return now - t <= ONLINE_WINDOW_MS;
}

/** Fire-and-forget last_seen_at updates, throttled per user. */
export function scheduleLastSeenTouch(userId, touchFn) {
  if (!userId || typeof touchFn !== "function") return;
  const now = Date.now();
  if ((lastTouchMs.get(userId) ?? 0) + TOUCH_INTERVAL_MS > now) return;
  lastTouchMs.set(userId, now);
  Promise.resolve(touchFn(userId)).catch(() => {});
}

export function resetLastSeenTouchForTests() {
  lastTouchMs.clear();
}
