import { httpError } from "./httpError.mjs";

/** Same pattern as cameras_youtube_video_id_format_check in 010_camera_youtube_source.sql */
export const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const CAMERA_SOURCES = ["webrtc", "youtube"];

const INVALID = "Invalid YouTube video URL or id";

export function cameraSource(row) {
  return String(row?.source ?? "webrtc") === "youtube" ? "youtube" : "webrtc";
}

export function isYoutubeCamera(row) {
  return cameraSource(row) === "youtube";
}

export function youtubeVideoIdForClient(row, { reveal } = {}) {
  if (!reveal || !isYoutubeCamera(row)) return null;
  const id = row?.youtube_video_id ?? row?.youtubeVideoId ?? null;
  return typeof id === "string" && YOUTUBE_VIDEO_ID_RE.test(id) ? id : null;
}

function hostKind(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") return "youtu.be";
  if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
    return "youtube.com";
  }
  return null;
}

function pathParts(pathname) {
  return String(pathname ?? "")
    .split("/")
    .filter((part) => part.length > 0);
}

function asVideoId(value) {
  const id = String(value ?? "").trim();
  return YOUTUBE_VIDEO_ID_RE.test(id) ? id : null;
}

function idFromYoutubeUrl(raw) {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const kind = hostKind(url.hostname);
  if (!kind) return null;
  const parts = pathParts(url.pathname);

  if (kind === "youtu.be") {
    if (parts.length !== 1) return null;
    return asVideoId(parts[0]);
  }

  if (parts.length === 1 && parts[0] === "watch") {
    return asVideoId(url.searchParams.get("v"));
  }
  if (parts.length === 2 && parts[0] === "live") {
    return asVideoId(parts[1]);
  }
  return null;
}

/** Parse a watch / youtu.be / live URL or a bare 11-char id. Rejects stream keys. */
export function parseYoutubeVideoId(input) {
  if (typeof input !== "string") {
    throw httpError(400, INVALID);
  }
  const raw = input.trim();
  if (!raw) {
    throw httpError(400, INVALID);
  }
  const bare = asVideoId(raw);
  if (bare) return bare;
  const fromUrl = idFromYoutubeUrl(raw);
  if (fromUrl) return fromUrl;
  throw httpError(400, INVALID);
}

export function parseCameraSource(value) {
  const source = String(value ?? "").trim();
  if (!CAMERA_SOURCES.includes(source)) {
    throw httpError(400, "source must be webrtc or youtube");
  }
  return source;
}

function youtubeInput(body) {
  if (!body || typeof body !== "object") return undefined;
  if (body.youtubeUrl != null) return body.youtubeUrl;
  if (body.youtube_url != null) return body.youtube_url;
  if (body.youtubeVideoId != null) return body.youtubeVideoId;
  if (body.youtube_video_id != null) return body.youtube_video_id;
  return undefined;
}

/**
 * PATCH/POST source + YouTube URL/id. Returns null when the body does not
 * touch source. Stores only the 11-char id; never a stream key.
 */
export function sourceFieldsFromBody(body, existing = {}) {
  const rawYoutube = youtubeInput(body);
  const hasSource = body?.source != null && String(body.source).trim() !== "";
  const hasYoutube = rawYoutube != null && String(rawYoutube).trim() !== "";
  if (!hasSource && !hasYoutube) return null;

  const source = hasSource
    ? parseCameraSource(body.source)
    : hasYoutube
      ? "youtube"
      : cameraSource(existing);

  if (source === "webrtc") {
    if (hasYoutube) {
      throw httpError(400, "youtubeUrl is only valid when source is youtube");
    }
    return { source: "webrtc", youtubeVideoId: null };
  }

  if (hasYoutube) {
    return { source: "youtube", youtubeVideoId: parseYoutubeVideoId(String(rawYoutube)) };
  }
  const current = existing.youtube_video_id ?? existing.youtubeVideoId ?? null;
  if (typeof current === "string" && YOUTUBE_VIDEO_ID_RE.test(current)) {
    return { source: "youtube", youtubeVideoId: current };
  }
  throw httpError(400, "youtubeUrl or youtubeVideoId is required when source is youtube");
}

export function assertWebrtcSignalling(camera) {
  if (isYoutubeCamera(camera)) {
    throw httpError(400, "ICE and signalling are not used for YouTube cameras");
  }
}
