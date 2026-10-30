import {
  closeListenClient,
  createListenClient,
  isTransactionPoolerUrl,
  listenClientConfig,
} from "../utils/listenDb.mjs";
import { utcIso, utcIsoFields } from "../utils/iso.mjs";
import { MAX_VIEWERS_PER_CAMERA } from "../utils/cameraSignal.mjs";
import { httpError } from "../utils/httpError.mjs";
import { camerasRepository } from "../repositories/cameras.repository.mjs";

export const CAMERA_CHANNEL = "camera_events";

const clients = new Set();
const sessions = new Map();

let listenClient = null;
let reconnectTimer = null;
let watchTimer = null;

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === "function") res.flush();
}

export function normalizeCameraSsePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const next = utcIsoFields(payload, ["lastSeenAt", "validFrom", "validTo"]);
  if (next.camera && typeof next.camera === "object") {
    next.camera = utcIsoFields(next.camera, ["lastSeenAt"]);
  }
  if (Array.isArray(next.cameras)) {
    next.cameras = next.cameras.map((camera) =>
      camera && typeof camera === "object"
        ? utcIsoFields(camera, ["lastSeenAt"])
        : camera
    );
  }
  if (next.access && typeof next.access === "object") {
    next.access = utcIsoFields(next.access, ["validFrom", "validTo", "now"]);
  }
  return next;
}

function subscriberMatches(sub, event) {
  if (sub.bookingId) {
    if (!event.bookingId || String(event.bookingId) !== String(sub.bookingId)) {
      return false;
    }
  }
  if (sub.sitterId) {
    if (event.sitterId && String(event.sitterId) !== String(sub.sitterId)) {
      return false;
    }
  }
  if (event.toUserId && String(event.toUserId) !== String(sub.userId)) {
    return false;
  }
  if (sub.cameraIds instanceof Set && event.cameraId) {
    if (!sub.cameraIds.has(String(event.cameraId))) return false;
  }
  return true;
}

export function publishCameraEvent(payload) {
  const normalized = normalizeCameraSsePayload(payload);
  let sent = 0;
  for (const sub of [...clients]) {
    if (!subscriberMatches(sub, normalized)) continue;
    try {
      sendEvent(sub.res, normalized);
      sent += 1;
    } catch {
      clients.delete(sub);
    }
  }
  return sent;
}

export function cameraStreamCount() {
  return clients.size;
}

export function resetCameraClients() {
  clients.clear();
  sessions.clear();
}

export function getCameraSession(sessionId) {
  return sessions.get(String(sessionId)) ?? null;
}

export function listSessionsForCamera(cameraId) {
  const id = String(cameraId);
  return [...sessions.values()].filter((row) => String(row.cameraId) === id);
}

export function openCameraSession({
  sessionId,
  cameraId,
  bookingId,
  viewerId,
  publisherId,
  validTo,
}) {
  const key = String(sessionId);
  const existing = sessions.get(key);
  if (existing) {
    if (
      String(existing.cameraId) !== String(cameraId) ||
      String(existing.viewerId) !== String(viewerId)
    ) {
      throw httpError(409, "sessionId is already in use");
    }
    return existing;
  }
  const live = listSessionsForCamera(cameraId);
  if (live.length >= MAX_VIEWERS_PER_CAMERA) {
    throw httpError(429, "Too many live viewers for this camera");
  }
  const session = {
    sessionId: key,
    cameraId: String(cameraId),
    bookingId: String(bookingId),
    viewerId: String(viewerId),
    publisherId: String(publisherId),
    validTo: validTo ? new Date(validTo) : null,
  };
  sessions.set(key, session);
  return session;
}

function emitSessionEnded(session, reason) {
  const payload = {
    type: "session-ended",
    reason,
    sessionId: session.sessionId,
    cameraId: session.cameraId,
    bookingId: session.bookingId,
    fromUserId: session.publisherId,
    toUserId: session.viewerId,
    sitterId: session.publisherId,
  };
  publishCameraEvent(payload);
  publishCameraEvent({ ...payload, fromUserId: session.viewerId, toUserId: session.publisherId });
}

export function endSessionsForCamera(cameraId, reason = "camera_disabled") {
  const id = String(cameraId);
  let ended = 0;
  for (const [key, session] of [...sessions.entries()]) {
    if (String(session.cameraId) !== id) continue;
    sessions.delete(key);
    emitSessionEnded(session, reason);
    ended += 1;
  }
  return ended;
}

export function endSessionsForBooking(bookingId, reason = "window_ended") {
  const id = String(bookingId);
  let ended = 0;
  for (const [key, session] of [...sessions.entries()]) {
    if (String(session.bookingId) !== id) continue;
    sessions.delete(key);
    emitSessionEnded(session, reason);
    ended += 1;
  }
  return ended;
}

export function expireCameraSessions(now = new Date()) {
  let ended = 0;
  for (const [key, session] of [...sessions.entries()]) {
    if (!session.validTo) continue;
    if (now <= session.validTo) continue;
    sessions.delete(key);
    emitSessionEnded(session, "window_ended");
    ended += 1;
  }
  return ended;
}

async function handleNotification(raw, { now, listRecipients } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (parsed?.type === "camera:status" && parsed.cameraId) {
    const recipients = await listRecipients(parsed.cameraId, now?.() ?? new Date());
    publishCameraEvent({
      type: "camera:status",
      cameraId: parsed.cameraId,
      sitterId: parsed.sitterId,
      status: parsed.status,
      isEnabled: parsed.isEnabled,
      lastSeenAt: utcIso(parsed.lastSeenAt),
      name: parsed.name,
    });
    for (const row of recipients) {
      publishCameraEvent({
        type: "camera:status",
        cameraId: parsed.cameraId,
        bookingId: row.booking_id ?? row.bookingId,
        toUserId: row.owner_id ?? row.ownerId,
        sitterId: parsed.sitterId,
        status: parsed.status,
        isEnabled: parsed.isEnabled,
        lastSeenAt: utcIso(parsed.lastSeenAt),
        name: parsed.name,
      });
    }
    return;
  }
  if (parsed?.type) {
    publishCameraEvent(parsed);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startCameraListener();
  }, 3000);
  reconnectTimer.unref?.();
}

export async function startCameraListener({
  listRecipients = (cameraId, now) =>
    camerasRepository.listActiveGrantRecipients(cameraId, now),
} = {}) {
  const previous = listenClient;
  listenClient = null;
  await closeListenClient(previous);

  let client;
  try {
    const config = listenClientConfig();
    if (isTransactionPoolerUrl(config.connectionString)) {
      console.warn(
        "Camera LISTEN is using a transaction pooler (port 6543). Set LISTEN_DATABASE_URL to the session pooler (5432) or a direct URI."
      );
    }
    client = createListenClient();
    await client.connect();
    listenClient = client;

    client.on("error", (error) => {
      console.error("Camera realtime connection error:", error.message);
      if (listenClient === client) listenClient = null;
      closeListenClient(client).catch(() => {});
      scheduleReconnect();
    });

    client.on("end", () => {
      if (listenClient !== client) return;
      listenClient = null;
      scheduleReconnect();
    });

    client.on("notification", (notification) => {
      if (notification.channel !== CAMERA_CHANNEL || !notification.payload) return;
      handleNotification(notification.payload, { listRecipients }).catch((error) => {
        console.error("Camera realtime notify failed:", error.message);
      });
    });

    await client.query(`LISTEN ${CAMERA_CHANNEL}`);
    console.log("Camera realtime listener ready");
  } catch (error) {
    listenClient = null;
    await closeListenClient(client);
    console.error("Camera realtime listener failed:", error.message);
    scheduleReconnect();
  }
}

export function startCameraWatch({
  intervalMs = 10_000,
  staleMs = 30_000,
  markStale = (ms) => camerasRepository.markStaleOffline(ms),
} = {}) {
  if (watchTimer) return watchTimer;
  watchTimer = setInterval(() => {
    expireCameraSessions();
    Promise.resolve(markStale(staleMs)).catch((error) => {
      console.error("Camera heartbeat watch failed:", error.message);
    });
  }, intervalMs);
  watchTimer.unref?.();
  return watchTimer;
}

export function stopCameraWatch() {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

export function subscribeCameraEvents(sub, req, res, snapshot = null) {
  req.socket?.setTimeout?.(0);
  res.setTimeout?.(0);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.status(200);
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const record = {
    userId: String(sub.userId),
    bookingId: sub.bookingId ? String(sub.bookingId) : null,
    cameraIds: sub.cameraIds
      ? new Set([...sub.cameraIds].map((id) => String(id)))
      : null,
    res,
  };
  clients.add(record);

  sendEvent(
    res,
    normalizeCameraSsePayload(
      snapshot ?? { type: "connected", userId: record.userId }
    )
  );

  const ping = setInterval(() => {
    try {
      res.write(":\n\n");
    } catch {
      cleanup();
    }
  }, 15000);
  ping.unref?.();

  function cleanup() {
    clearInterval(ping);
    clients.delete(record);
    if (typeof sub.onClose === "function") {
      sub.onClose();
    }
  }

  req.on("close", cleanup);
  res.on("close", cleanup);

  return cleanup;
}

export { handleNotification as handleCameraNotification };
