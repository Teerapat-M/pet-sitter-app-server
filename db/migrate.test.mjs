import assert from "node:assert/strict";
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
});
