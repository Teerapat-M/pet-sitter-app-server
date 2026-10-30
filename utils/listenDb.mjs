import pg from "pg";
import { sslForDatabaseUrl } from "./pgSsl.mjs";

const { Client } = pg;

/** Supabase transaction pooler — PgBouncer transaction mode cannot LISTEN. */
export function isTransactionPoolerUrl(connectionString) {
  if (!connectionString) return false;
  try {
    return new URL(connectionString).port === "6543";
  } catch {
    return /:6543(?:\/|\?|$)/.test(String(connectionString));
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
