/** SSL for pg: off on loopback or sslmode=disable; otherwise rejectUnauthorized false. */
export function sslForDatabaseUrl(connectionString) {
  if (!connectionString) return undefined;

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return { rejectUnauthorized: false };
  }

  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslmode === "disable") return undefined;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return undefined;
  }

  return { rejectUnauthorized: false };
}
