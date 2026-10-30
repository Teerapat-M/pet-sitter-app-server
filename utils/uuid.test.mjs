import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUuid, requireUuid } from "./uuid.mjs";

describe("isUuid / requireUuid", () => {
  it("accepts a UUID and 400s garbage before it can hit Postgres", () => {
    assert.equal(isUuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), true);
    assert.equal(isUuid("sig-1"), false);
    assert.equal(isUuid("not-a-uuid"), false);
    assert.equal(requireUuid("ca000001-0001-4001-8001-000000000001", "cameraId"), "ca000001-0001-4001-8001-000000000001");
    assert.throws(
      () => requireUuid("not-a-uuid", "cameraId"),
      (err) => err.statusCode === 400 && err.message === "Invalid cameraId"
    );
    assert.throws(
      () => requireUuid("sess-1", "sessionId"),
      (err) => err.statusCode === 400 && /sessionId/.test(err.message)
    );
  });
});
