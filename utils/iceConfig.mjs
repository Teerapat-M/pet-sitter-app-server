export const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";

function splitUrls(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** ICE servers for browser RTCPeerConnection. STUN is always present; TURN is optional env. */
export function iceServersFromEnv(env = process.env) {
  const iceServers = [{ urls: [DEFAULT_STUN_URL] }];
  const turnUrls = splitUrls(env.TURN_URLS);
  if (turnUrls.length === 0) {
    return iceServers;
  }
  const username = String(env.TURN_USERNAME ?? "").trim();
  const credential = String(env.TURN_CREDENTIAL ?? "").trim();
  const turn = { urls: turnUrls };
  if (username) turn.username = username;
  if (credential) turn.credential = credential;
  iceServers.push(turn);
  return iceServers;
}

export function iceConfigFromEnv(env = process.env) {
  return { iceServers: iceServersFromEnv(env) };
}
