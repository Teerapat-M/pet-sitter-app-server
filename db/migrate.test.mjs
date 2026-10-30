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
    ]);
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
