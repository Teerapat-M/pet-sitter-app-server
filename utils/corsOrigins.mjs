/** Local Next.js ports always allowed so `npm run dev` works without extra env. */
export const LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

/** Split FRONTEND_URL on commas; trim and drop a trailing slash. */
export function parseFrontendOrigins(value = "") {
  return String(value)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** CORS allow-list: localhost defaults plus FRONTEND_URL (comma-separated). */
export function corsAllowList(frontendUrl = process.env.FRONTEND_URL) {
  const seen = new Set();
  const list = [];
  for (const origin of [...LOCAL_DEV_ORIGINS, ...parseFrontendOrigins(frontendUrl)]) {
    if (seen.has(origin)) continue;
    seen.add(origin);
    list.push(origin);
  }
  return list;
}
