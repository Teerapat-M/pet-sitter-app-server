import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { SITTER_SLOT_LOCK_SQL, lockSitterSlot } from "./sitterLock.mjs";

describe("sitter slot lock", () => {
  it("uses a transaction advisory lock keyed by sitter id", () => {
    assert.match(SITTER_SLOT_LOCK_SQL, /pg_advisory_xact_lock/);
    assert.match(SITTER_SLOT_LOCK_SQL, /hashtext\(\$1::text\)/);
  });

  it("passes sitterId through a bound query (does not destructure pool.query)", async () => {
    const calls = [];
    const client = {
      async query(...args) {
        calls.push(args);
        return { rows: [{ pg_advisory_xact_lock: true }] };
      },
    };
    await lockSitterSlot((...args) => client.query(...args), "sitter-1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1][0], "sitter-1");
  });

  it("is taken in create and reschedule before the overlap check", () => {
    const src = fs.readFileSync(
      fileURLToPath(new URL("../repositories/bookings.repository.mjs", import.meta.url)),
      "utf8"
    );
    const createAt = src.indexOf("async createBookingWithPets");
    const rescheduleAt = src.indexOf("async updateScheduleByIdAndOwnerId");
    const createLock = src.indexOf("lockSitterSlot(query, sitterId)", createAt);
    const createOverlap = src.indexOf("OVERLAP_SQL", createAt);
    const rescheduleLock = src.indexOf("lockSitterSlot(query, sitterId)", rescheduleAt);
    const rescheduleOverlap = src.indexOf("OVERLAP_SQL", rescheduleAt);
    assert.ok(createLock > createAt && createLock < createOverlap);
    assert.ok(rescheduleLock > rescheduleAt && rescheduleLock < rescheduleOverlap);
  });
});
