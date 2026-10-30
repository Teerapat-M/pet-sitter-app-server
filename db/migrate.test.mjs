import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listMigrationFiles } from "./migrate.mjs";

describe("listMigrationFiles", () => {
  it("returns numbered SQL files in order", () => {
    const files = listMigrationFiles();
    assert.deepEqual(files, [
      "001_init.sql",
      "002_services_cameras_walks.sql",
    ]);
  });
});
