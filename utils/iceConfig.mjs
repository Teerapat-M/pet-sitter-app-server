import { createHmac } from "node:crypto";

export const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";
/** Short-lived coturn REST TTL (seconds). */
export const DEFAULT_TURN_TTL_SECONDS = 300;

function splitUrls(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * coturn REST API credentials: username = `${expiryUnix}:${userId}`,
 * credential = base64(HMAC-SHA1(TURN_SECRET, username)).
 */
export function turnRestCredentials(
  userId,
  secret,
  { now = Date.now(), ttlSeconds = DEFAULT_TURN_TTL_SECONDS } = {}
) {
  const expiry = Math.floor(Number(now) / 1000) + Number(ttlSeconds);
  const username = `${expiry}:${userId}`;
  const credential = createHmac("sha1", String(secret))
    .update(username)
    .digest("base64");
  return { username, credential, ttlSeconds: Number(ttlSeconds), expiry };
}

/** ICE servers. TURN_SECRET wins (ephemeral HMAC). Static user/pass is fallback only. */
export function iceServersFromEnv(
  env = process.env,
  { userId, now = Date.now(), ttlSeconds = DEFAULT_TURN_TTL_SECONDS } = {}
) {
  const iceServers = [{ urls: [DEFAULT_STUN_URL] }];
  const turnUrls = splitUrls(env.TURN_URLS);
  if (turnUrls.length === 0) {
    return iceServers;
  }
  const turn = { urls: turnUrls };
  const secret = String(env.TURN_SECRET ?? "").trim();
  if (secret && userId) {
    const creds = turnRestCredentials(userId, secret, { now, ttlSeconds });
    turn.username = creds.username;
    turn.credential = creds.credential;
  } else if (!secret) {
    const username = String(env.TURN_USERNAME ?? "").trim();
    const credential = String(env.TURN_CREDENTIAL ?? "").trim();
    if (username) turn.username = username;
    if (credential) turn.credential = credential;
  }
  iceServers.push(turn);
  return iceServers;
}

export function iceConfigFromEnv(env = process.env, opts = {}) {
  return { iceServers: iceServersFromEnv(env, opts) };
}
