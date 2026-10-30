/** SSL for pg: off on loopback, unix sockets, or sslmode=disable; otherwise rejectUnauthorized false. */

const SSL_ON = { rejectUnauthorized: false };
const FORCE_SSL_ON = new Set(["require", "verify-ca", "verify-full"]);

function decodeHost(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePgUrl(connectionString) {
  try {
    return new URL(connectionString);
  } catch {
    // libpq allows postgres://user:pass@/db?host=/socket — invalid as a WHATWG URL.
    const q = connectionString.indexOf("?");
    if (q === -1) return null;
    return { hostname: "", searchParams: new URLSearchParams(connectionString.slice(q + 1)) };
  }
}

function unixSocketHost(url) {
  const hostname = decodeHost(url.hostname).replace(/^\[|\]$/g, "");
  const queryHost = decodeHost(url.searchParams.get("host") ?? "");
  return hostname.startsWith("/") || queryHost.startsWith("/");
}

export function sslForDatabaseUrl(connectionString) {
  if (!connectionString) return undefined;

  const url = parsePgUrl(connectionString);
  if (!url) return SSL_ON;

  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslmode === "disable") return undefined;
  if (FORCE_SSL_ON.has(sslmode)) return SSL_ON;

  if (unixSocketHost(url)) return undefined;

  const host = decodeHost(url.hostname).toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return undefined;
  }

  return SSL_ON;
}
