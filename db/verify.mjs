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
  "camera_signals",
  "walks",
  "walk_points",
  "schema_migrations",
];

const BOARDING_BOOKING_ID = "b0000001-0001-4001-8001-000000000001";

async function assertCameraGrantsClipAndRevoke(client) {
  await client.query("BEGIN");
  try {
    const { rows: grantRows } = await client.query(
      `SELECT booking_id, camera_id, valid_from, valid_to
       FROM public.camera_access_grants
       WHERE booking_id = $1
       LIMIT 1
       FOR UPDATE`,
      [BOARDING_BOOKING_ID]
    );
    const grant = grantRows[0];
    if (!grant) {
      throw new Error("seed did not insert camera_access_grants");
    }

    await client.query(
      `UPDATE public.bookings
       SET end_date = end_date - 1,
           updated_at = NOW()
       WHERE id = $1`,
      [grant.booking_id]
    );

    const { rows: clipped } = await client.query(
      `SELECT valid_from, valid_to
       FROM public.camera_access_grants
       WHERE booking_id = $1 AND camera_id = $2`,
      [grant.booking_id, grant.camera_id]
    );
    if (!clipped[0]) {
      throw new Error("expected grant to clip, not vanish, on a one-day shrink");
    }
    if (clipped[0].valid_to.getTime() >= grant.valid_to.getTime()) {
      throw new Error("camera grant valid_to was not clipped after reschedule");
    }

    await client.query(
      `UPDATE public.bookings
       SET start_date = end_date,
           start_time = end_time,
           updated_at = NOW()
       WHERE id = $1`,
      [grant.booking_id]
    );

    const { rows: revoked } = await client.query(
      `SELECT 1 FROM public.camera_access_grants WHERE booking_id = $1`,
      [grant.booking_id]
    );
    if (revoked.length) {
      throw new Error("camera grants were not revoked when the window collapsed");
    }
  } finally {
    await client.query("ROLLBACK");
  }
}

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

  const { rows: colRows } = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'onboarding_seen_at'`
  );
  if (!colRows[0]) {
    throw new Error("users.onboarding_seen_at is missing");
  }

  const { rows: presenceCols } = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users'
           AND column_name = 'last_seen_at'
       ) AS has_last_seen,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'conversations'
           AND column_name = 'booking_id'
       ) AS has_booking_id`
  );
  if (!presenceCols[0]?.has_last_seen) {
    throw new Error("users.last_seen_at is missing");
  }
  if (!presenceCols[0]?.has_booking_id) {
    throw new Error("conversations.booking_id is missing");
  }

  const { rows: phase3Cols } = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'bookings'
           AND column_name = 'owner_address'
       ) AS has_owner_address,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'bookings'
           AND column_name = 'access_instructions'
       ) AS has_access_instructions`
  );
  if (!phase3Cols[0]?.has_owner_address) {
    throw new Error("bookings.owner_address is missing");
  }
  if (!phase3Cols[0]?.has_access_instructions) {
    throw new Error("bookings.access_instructions is missing");
  }

  const { rows: walkIdx } = await client.query(
    `SELECT 1
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'walks_one_per_booking_idx'`
  );
  if (!walkIdx[0]) {
    throw new Error("walks_one_per_booking_idx is missing");
  }

  await assertCameraGrantsClipAndRevoke(client);

  console.log(`ok: ${TABLES.length} tables, ${walkRows[0].n} walk_points`);
} finally {
  await client.end();
}
