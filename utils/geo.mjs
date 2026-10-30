const EARTH_RADIUS_M = 6371000;

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres (WGS84 sphere). */
export function haversineMeters(from, to) {
  if (!from || !to) return 0;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function speedMps(from, to, fromAt, toAt) {
  const dtMs = new Date(toAt).getTime() - new Date(fromAt).getTime();
  if (!Number.isFinite(dtMs) || dtMs <= 0) return Infinity;
  return haversineMeters(from, to) / (dtMs / 1000);
}

export function sumPathMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

export function encodeLatLngPolyline(points) {
  return points
    .map((point) => `${Number(point.lat).toFixed(5)},${Number(point.lng).toFixed(5)}`)
    .join("|");
}
