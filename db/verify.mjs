import pg from "pg";
import "dotenv/config";
import { poolConfig } from "./migrate.mjs";

const { Client } = pg;

const TABLES = [
  "users",
  "pet_types",
  "pets",
  "sitter_profiles",
  "sitter_pet_types",
  "sitter_photos",
  "bookings",
  "booking_pets",
  "payments",
  "reviews",
  "reports",
  "conversations",
  "messages",
  "notifications",
  "services",
  "cameras",
  "camera_access_grants",
  "walks",
  "walk_points",
  "schema_migrations",
];

const client = new Client(poolConfig());
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename = ANY($1::text[])`,
    [TABLES]
  );
  const found = new Set(rows.map((row) => row.tablename));
  const missing = TABLES.filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`missing tables: ${missing.join(", ")}`);
  }

  const { rows: walkRows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM public.walk_points`
  );
  if (walkRows[0].n < 1) {
    throw new Error("seed did not insert walk_points");
  }

  console.log(`ok: ${TABLES.length} tables, ${walkRows[0].n} walk_points`);
} finally {
  await client.end();
}
