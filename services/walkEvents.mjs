import { pool } from "../repositories/db.mjs";

const CHANNEL = "walk_events";
const clients = new Map();

let listenClient = null;
let reconnectTimer = null;

function bookingKey(bookingId) {
  return String(bookingId ?? "");
}

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === "function") res.flush();
}

function removeClient(bookingId, res) {
  const key = bookingKey(bookingId);
  const set = clients.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(key);
}

export function publishWalkEvent(payload) {
  const key = bookingKey(payload?.bookingId);
  const set = clients.get(key);
  if (!set) return 0;
  let sent = 0;
  for (const res of [...set]) {
    try {
      sendEvent(res, payload);
      sent += 1;
    } catch {
      removeClient(key, res);
    }
  }
  return sent;
}

export function walkStreamCount(bookingId) {
  return clients.get(bookingKey(bookingId))?.size ?? 0;
}

export function resetWalkClients() {
  clients.clear();
}

async function handleNotification(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed?.bookingId) return;
  publishWalkEvent(parsed);
}

async function ensureNotifyTrigger(client) {
  await client.query(`LISTEN ${CHANNEL}`);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWalkListener();
  }, 3000);
}

export async function startWalkListener() {
  if (listenClient) {
    try {
      listenClient.removeAllListeners();
      listenClient.release();
    } catch {
      // ignore
    }
    listenClient = null;
  }

  try {
    const client = await pool.connect();
    listenClient = client;

    client.on("error", (error) => {
      console.error("Walk realtime connection error:", error.message);
      listenClient = null;
      try {
        client.release();
      } catch {
        // ignore
      }
      scheduleReconnect();
    });

    client.on("notification", (notification) => {
      if (notification.channel !== CHANNEL || !notification.payload) return;
      handleNotification(notification.payload).catch((error) => {
        console.error("Walk realtime notify failed:", error.message);
      });
    });

    await ensureNotifyTrigger(client);
    console.log("Walk realtime listener ready");
  } catch (error) {
    listenClient = null;
    console.error("Walk realtime listener failed:", error.message);
    scheduleReconnect();
  }
}

export function subscribeWalkEvents(bookingId, req, res, snapshot = null) {
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

  const key = bookingKey(bookingId);
  let set = clients.get(key);
  if (!set) {
    set = new Set();
    clients.set(key, set);
  }
  set.add(res);

  sendEvent(res, snapshot ?? { type: "connected", bookingId: key });

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
    removeClient(key, res);
  }

  req.on("close", cleanup);
  res.on("close", cleanup);

  return cleanup;
}
