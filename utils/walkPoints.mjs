import { httpError } from "./httpError.mjs";
import { haversineMeters, speedMps } from "./geo.mjs";

export const MAX_BATCH = 60;
export const MIN_INTERVAL_MS = 2000;
export const MAX_FUTURE_MS = 30_000;
export const MAX_SPEED_MPS = 20;
export const MAX_ACCURACY_M = 5000;
export const MAX_WALK_MS = 6 * 60 * 60 * 1000;
export const MAX_POSTS_PER_MINUTE = 20;

const windows = new Map();

export function resetWalkPostRate() {
  windows.clear();
}

export function assertWalkPostRate(walkId, now = Date.now()) {
  const key = String(walkId);
  const slot = windows.get(key);
  if (!slot || now - slot.start >= 60_000) {
    windows.set(key, { start: now, count: 1 });
    return;
  }
  slot.count += 1;
  if (slot.count > MAX_POSTS_PER_MINUTE) {
    throw httpError(
      429,
      "Too many walk point posts. Slow down to every 5–10 seconds."
    );
  }
}

function asNumber(value, field) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw httpError(400, `Invalid ${field}`);
  }
  return n;
}

export function parseRecordedAt(value, now = Date.now()) {
  if (value == null || value === "") {
    return new Date(now);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
      throw httpError(400, "Invalid recordedAt");
    }
    return date;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, "Invalid recordedAt");
  }
  return date;
}

export function parseWalkPoint(raw, now = Date.now()) {
  const lat = asNumber(raw?.lat, "lat");
  const lng = asNumber(raw?.lng ?? raw?.lon, "lng");
  if (lat < -90 || lat > 90) {
    throw httpError(400, "lat must be between -90 and 90");
  }
  if (lng < -180 || lng > 180) {
    throw httpError(400, "lng must be between -180 and 180");
  }

  let accuracy = null;
  if (raw?.accuracy != null && raw.accuracy !== "") {
    accuracy = asNumber(raw.accuracy, "accuracy");
    if (accuracy < 0 || accuracy > MAX_ACCURACY_M) {
      throw httpError(400, "accuracy is out of range");
    }
  }

  const recordedAt = parseRecordedAt(
    raw?.recordedAt ?? raw?.recorded_at,
    now
  );
  if (recordedAt.getTime() - now > MAX_FUTURE_MS) {
    throw httpError(400, "recordedAt cannot be in the future");
  }

  return { lat, lng, accuracy, recordedAt };
}

export function normalizeWalkPointsBody(body) {
  if (Array.isArray(body?.points)) {
    return body.points;
  }
  if (body?.lat != null && (body?.lng != null || body?.lon != null)) {
    return [body];
  }
  throw httpError(400, "points is required");
}

/**
 * Keep points that are in range, not in the future, not before the walk
 * started, spaced ≥ 2s, and slower than MAX_SPEED_MPS from the last kept
 * point. Outliers are skipped so a GPS jump does not fail the batch.
 */
export function filterWalkPoints(rawPoints, { lastPoint = null, startedAt, now = Date.now() } = {}) {
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) {
    throw httpError(400, "points is required");
  }
  if (rawPoints.length > MAX_BATCH) {
    throw httpError(400, `At most ${MAX_BATCH} points per request`);
  }

  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const accepted = [];
  const skipped = [];
  let prev = lastPoint
    ? {
        lat: Number(lastPoint.lat),
        lng: Number(lastPoint.lng),
        recordedAt: new Date(lastPoint.recorded_at ?? lastPoint.recordedAt),
      }
    : null;

  for (const raw of rawPoints) {
    let point;
    try {
      point = parseWalkPoint(raw, now);
    } catch (error) {
      skipped.push({ reason: error.message, point: raw });
      continue;
    }

    const at = point.recordedAt.getTime();
    if (startedMs != null && at < startedMs - 5000) {
      skipped.push({ reason: "recordedAt is before the walk started", point: raw });
      continue;
    }
    if (startedMs != null && at - startedMs > MAX_WALK_MS) {
      skipped.push({ reason: "recordedAt is past the max walk length", point: raw });
      continue;
    }

    if (prev) {
      const dt = at - prev.recordedAt.getTime();
      if (dt < MIN_INTERVAL_MS) {
        skipped.push({ reason: "points must be at least 2 seconds apart", point: raw });
        continue;
      }
      const speed = speedMps(prev, point, prev.recordedAt, point.recordedAt);
      if (speed > MAX_SPEED_MPS) {
        skipped.push({ reason: "speed outlier", point: raw });
        continue;
      }
    }

    accepted.push(point);
    prev = point;
  }

  if (accepted.length === 0) {
    throw httpError(400, skipped[0]?.reason || "No valid points");
  }

  return { accepted, skipped };
}

export function incrementalDistanceM(lastPoint, accepted) {
  if (!accepted.length) return 0;
  const chain = [];
  if (lastPoint) {
    chain.push({
      lat: Number(lastPoint.lat),
      lng: Number(lastPoint.lng),
    });
  }
  for (const point of accepted) {
    chain.push(point);
  }
  let total = 0;
  for (let i = 1; i < chain.length; i += 1) {
    total += haversineMeters(chain[i - 1], chain[i]);
  }
  return total;
}
