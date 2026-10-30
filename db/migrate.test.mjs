import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { listMigrationFiles } from "./migrate.mjs";

describe("listMigrationFiles", () => {
  it("returns numbered SQL files in order", () => {
    const files = listMigrationFiles();
    assert.deepEqual(files, [
      "001_init.sql",
      "002_services_cameras_walks.sql",
      "003_onboarding_seen_at.sql",
      "004_clip_camera_grants_on_reschedule.sql",
      "005_conversation_booking_and_presence.sql",
      "006_booking_phase3.sql",
      "007_walk_tracking.sql",
      "008_cctv_webrtc.sql",
      "009_camera_signals.sql",
    ]);
  });

  it("009 stores signalling payloads and indexes created_at", () => {
    const sql = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/009_camera_signals.sql"),
      "utf8"
    );
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.camera_signals/);
    assert.match(sql, /camera_signals_created_at_idx/);
    assert.match(sql, /older than 5 minutes/);
    assert.match(sql, /payload jsonb NOT NULL/);
  });

  it("008 notifies camera:status and ensures boarding grants", () => {
    const sql = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/008_cctv_webrtc.sql"),
      "utf8"
    );
    assert.match(sql, /pg_notify\('camera_events'/);
    assert.match(sql, /ensure_camera_grants_for_booking/);
    assert.match(sql, /cameras_status_notify/);
    assert.match(sql, /UPDATE OF status, service_id, venue_id, start_date, end_date, start_time, end_time/);
    assert.match(sql, /Idempotent backfill/);
    assert.match(sql, /b\.status = 'in_service'/);
    assert.match(sql, /c\.venue_id IS NOT DISTINCT FROM rec\.venue_id/);
    assert.match(sql, /ON CONFLICT \(booking_id, camera_id\) DO UPDATE SET/);
  });

  it("007 unique-indexes one walk per booking after deleting extras", () => {
    const sql = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/007_walk_tracking.sql"),
      "utf8"
    );
    const deleteAt = sql.indexOf("DELETE FROM public.walks");
    const uniqueAt = sql.indexOf("walks_one_per_booking_idx");
    assert.ok(deleteAt >= 0, "expected duplicate walk cleanup");
    assert.ok(uniqueAt > deleteAt, "unique index must come after cleanup");
    assert.match(sql, /pg_notify\('walk_events'/);
  });

  it("006 nulls duplicate conversation booking_ids before the unique index", () => {
    const sql = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/006_booking_phase3.sql"),
      "utf8"
    );
    const dedupeAt = sql.indexOf("SET booking_id = NULL");
    const uniqueAt = sql.indexOf("conversations_one_booking_idx");
    assert.ok(dedupeAt >= 0, "expected duplicate booking_id cleanup");
    assert.ok(uniqueAt > dedupeAt, "unique index must come after cleanup");
  });
});
