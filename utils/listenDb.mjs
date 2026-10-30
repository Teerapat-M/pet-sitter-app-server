import pg from "pg";
import { sslForDatabaseUrl } from "./pgSsl.mjs";

const { Client } = pg;

function parsePgUrl(connectionString) {
  try {
    return new URL(connectionString);
  } catch {
    return null;
  }
}

function hasPgBouncerParam(url, raw) {
  if (url) {
    const value = url.searchParams.get("pgbouncer");
    if (value == null || value === "") return false;
    return !["0", "false", "off"].includes(String(value).toLowerCase());
  }
  return /(?:\?|&)pgbouncer=/i.test(String(raw ?? ""));
}

function isPoolerHost(url, raw) {
  const host = url
    ? String(url.hostname ?? "").toLowerCase()
    : String(raw ?? "").toLowerCase();
  return host.includes("pooler") || host.includes("pgbouncer");
}

/** Supabase transaction pooler — PgBouncer transaction mode cannot LISTEN. */
export function isTransactionPoolerUrl(connectionString) {
  if (!connectionString) return false;
  const raw = String(connectionString);
  const url = parsePgUrl(raw);
  const port = url?.port || (raw.match(/:(\d+)(?:\/|\?|$)/) ?? [])[1];
  if (port === "6543") return true;
  return isPoolerHost(url, raw) && hasPgBouncerParam(url, raw);
}

const PRODUCTION_LISTEN_ERROR =
  "LISTEN_DATABASE_URL is required in production when DATABASE_URL is a transaction pooler (port 6543, or a pooler host with pgbouncer). Set it to the session pooler (5432) or a direct URI so chat and walk SSE can LISTEN.";

const PRODUCTION_LISTEN_POOLER_ERROR =
  "LISTEN_DATABASE_URL must not be a transaction pooler in production (port 6543, or a pooler host with pgbouncer). Set it to the session pooler (5432) or a direct URI so chat and walk SSE can LISTEN.";

/** Fail fast at boot: production LISTEN URI cannot be a transaction pooler. */
export function assertProductionListenConfig(env = process.env) {
  if (String(env.NODE_ENV ?? "").toLowerCase() !== "production") {
    return;
  }
  const listenUrl = String(env.LISTEN_DATABASE_URL ?? "").trim();
  if (listenUrl) {
    if (isTransactionPoolerUrl(listenUrl)) {
      throw new Error(PRODUCTION_LISTEN_POOLER_ERROR);
    }
    return;
  }
  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  if (isTransactionPoolerUrl(databaseUrl)) {
    throw new Error(PRODUCTION_LISTEN_ERROR);
  }
}

/**
 * Dedicated LISTEN/NOTIFY URI. Prefer LISTEN_DATABASE_URL (session pooler
 * :5432 or direct). Fall back to DATABASE_URL. Query pools stay on DATABASE_URL.
 */
export function listenDatabaseUrl(env = process.env) {
  const listen = String(env.LISTEN_DATABASE_URL ?? "").trim();
  if (listen) return listen;
  const fallback = String(env.DATABASE_URL ?? "").trim();
  return fallback || null;
}

export function listenClientConfig(env = process.env) {
  const connectionString = listenDatabaseUrl(env);
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  return {
    connectionString,
    ssl: sslForDatabaseUrl(connectionString),
    connectionTimeoutMillis: 8000,
  };
}

export function createListenClient(env = process.env, ClientCtor = Client) {
  return new ClientCtor(listenClientConfig(env));
}

export async function closeListenClient(client) {
  if (!client) return;
  try {
    client.removeAllListeners();
  } catch {
    // ignore
  }
  try {
    if (typeof client.release === "function") {
      client.release();
      return;
    }
  } catch {
    // ignore
  }
  try {
    await client.end();
  } catch {
    // ignore
  }
}
