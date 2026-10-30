import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";
import { sslForDatabaseUrl } from "../utils/pgSsl.mjs";

const { Client } = pg;

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

export function poolConfig(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  return {
    connectionString,
    ssl: sslForDatabaseUrl(connectionString),
  };
}

export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en"));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedIds(client) {
  const { rows } = await client.query(
    "SELECT id FROM public.schema_migrations ORDER BY id"
  );
  return new Set(rows.map((row) => row.id));
}

export async function migrate(connectionString = process.env.DATABASE_URL) {
  const client = new Client(poolConfig(connectionString));
  await client.connect();
  try {
    await ensureMigrationsTable(client);
    const done = await appliedIds(client);
    const files = listMigrationFiles();
    const pending = files.filter((name) => !done.has(name));

    if (pending.length === 0) {
      console.log("No pending migrations");
      return [];
    }

    const applied = [];
    for (const name of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.schema_migrations (id) VALUES ($1)",
          [name]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      applied.push(name);
      console.log(`applied ${name}`);
    }
    return applied;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  migrate().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
