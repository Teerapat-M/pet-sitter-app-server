import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ONLINE_WINDOW_MS,
  isOnline,
  resetLastSeenTouchForTests,
  scheduleLastSeenTouch,
} from "./presence.mjs";

describe("isOnline", () => {
  it("uses the last-seen window", () => {
    const now = 1_000_000;
    assert.equal(
      isOnline({ lastSeenAt: new Date(now - ONLINE_WINDOW_MS + 1), now }),
      true
    );
    assert.equal(
      isOnline({ lastSeenAt: new Date(now - ONLINE_WINDOW_MS - 1), now }),
      false
    );
  });
});

describe("scheduleLastSeenTouch", () => {
  it("throttles repeated touches", async () => {
    resetLastSeenTouchForTests();
    const seen = [];
    scheduleLastSeenTouch("u1", async (id) => {
      seen.push(id);
    });
    scheduleLastSeenTouch("u1", async (id) => {
      seen.push(id);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(seen, ["u1"]);
  });
});
