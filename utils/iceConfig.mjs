import { createHmac } from "node:crypto";

export const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";
/** Short-lived coturn REST / Cloudflare TURN TTL (seconds). */
export const DEFAULT_TURN_TTL_SECONDS = 300;
export const CLOUDFLARE_TURN_FETCH_TIMEOUT_MS = 5000;
export const CLOUDFLARE_TURN_PROVIDER = "cloudflare";
export const CLOUDFLARE_TURN_API_ORIGIN = "https://rtc.live.cloudflare.com";

const PRODUCTION_CLOUDFLARE_TURN_ERROR =
  "TURN_PROVIDER=cloudflare requires CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN in production.";

function splitUrls(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function urlsList(urls) {
  if (urls == null) return [];
  return (Array.isArray(urls) ? urls : [urls]).map((url) => String(url));
}

/** Browser clients block TURN on port 53; trickle ICE would wait on a timeout. */
function isBrowserBlockedTurnUrl(url) {
  return /:53(?:\?|$)/.test(String(url));
}

export function turnProvider(env = process.env) {
  return String(env.TURN_PROVIDER ?? "").trim().toLowerCase();
}

export function cloudflareTurnConfig(env = process.env) {
  return {
    keyId: String(env.CLOUDFLARE_TURN_KEY_ID ?? "").trim(),
    apiToken: String(env.CLOUDFLARE_TURN_API_TOKEN ?? "").trim(),
  };
}

export function cloudflareTurnCredentialsUrl(keyId) {
  return `${CLOUDFLARE_TURN_API_ORIGIN}/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
}

export function stunOnlyIceServers() {
  return [{ urls: [DEFAULT_STUN_URL] }];
}

/** Fail fast at boot: production Cloudflare TURN must have both env vars. */
export function assertProductionTurnConfig(env = process.env) {
  if (String(env.NODE_ENV ?? "").toLowerCase() !== "production") {
    return;
  }
  if (turnProvider(env) !== CLOUDFLARE_TURN_PROVIDER) {
    return;
  }
  const { keyId, apiToken } = cloudflareTurnConfig(env);
  if (!keyId || !apiToken) {
    throw new Error(PRODUCTION_CLOUDFLARE_TURN_ERROR);
  }
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

function redactSecrets(message, secrets) {
  let text = String(message ?? "unknown error");
  for (const secret of secrets) {
    if (!secret) continue;
    if (text.includes(secret)) {
      text = text.split(secret).join("[redacted]");
    }
  }
  return text;
}

function logTurnFailure(log, detail, secrets) {
  log(`Cloudflare TURN mint failed: ${redactSecrets(detail, secrets)}`);
}

function normalizeIceServersPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object" && payload.urls != null) return [payload];
  return [];
}

export function sanitizeCloudflareIceServers(payload) {
  const out = [];
  for (const server of normalizeIceServersPayload(payload)) {
    if (!server || typeof server !== "object") continue;
    const urls = urlsList(server.urls).filter((url) => !isBrowserBlockedTurnUrl(url));
    if (urls.length === 0) continue;
    const next = { urls };
    if (server.username != null && String(server.username).trim()) {
      next.username = String(server.username);
    }
    if (server.credential != null && String(server.credential).trim()) {
      next.credential = String(server.credential);
    }
    out.push(next);
  }
  return out;
}

function withDefaultStun(iceServers) {
  const hasDefault = iceServers.some((server) =>
    urlsList(server.urls).includes(DEFAULT_STUN_URL)
  );
  if (hasDefault) return iceServers;
  return [...stunOnlyIceServers(), ...iceServers];
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error("timeout");
      err.name = "AbortError";
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mint short-lived Cloudflare ICE servers. On any failure, STUN-only.
 * Logs never include the API token or minted credentials.
 */
export async function mintCloudflareIceServers(
  env = process.env,
  {
    fetchImpl = globalThis.fetch,
    ttlSeconds = DEFAULT_TURN_TTL_SECONDS,
    timeoutMs = CLOUDFLARE_TURN_FETCH_TIMEOUT_MS,
    log = console.error,
  } = {}
) {
  const { keyId, apiToken } = cloudflareTurnConfig(env);
  const secrets = [apiToken];
  if (!keyId || !apiToken) {
    logTurnFailure(log, "missing CLOUDFLARE_TURN_KEY_ID or CLOUDFLARE_TURN_API_TOKEN", secrets);
    return stunOnlyIceServers();
  }
  if (typeof fetchImpl !== "function") {
    logTurnFailure(log, "fetch is not available", secrets);
    return stunOnlyIceServers();
  }
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      cloudflareTurnCredentialsUrl(keyId),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: Number(ttlSeconds) }),
      },
      timeoutMs
    );
    if (!response?.ok) {
      const status = response?.status ?? "error";
      logTurnFailure(log, `HTTP ${status}`, secrets);
      return stunOnlyIceServers();
    }
    const data = await response.json();
    const iceServers = sanitizeCloudflareIceServers(data?.iceServers);
    if (iceServers.length === 0) {
      logTurnFailure(log, "empty iceServers", secrets);
      return stunOnlyIceServers();
    }
    return withDefaultStun(iceServers);
  } catch (error) {
    const detail =
      error?.name === "AbortError" || error?.name === "TimeoutError"
        ? "timeout"
        : error?.message || "request failed";
    logTurnFailure(log, detail, secrets);
    return stunOnlyIceServers();
  }
}

/** ICE servers. TURN_SECRET wins (ephemeral HMAC). Static user/pass is fallback only. */
export function iceServersFromEnv(
  env = process.env,
  { userId, now = Date.now(), ttlSeconds = DEFAULT_TURN_TTL_SECONDS } = {}
) {
  const iceServers = stunOnlyIceServers();
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

export async function iceConfigFromEnv(env = process.env, opts = {}) {
  if (turnProvider(env) === CLOUDFLARE_TURN_PROVIDER) {
    return { iceServers: await mintCloudflareIceServers(env, opts) };
  }
  return { iceServers: iceServersFromEnv(env, opts) };
}
