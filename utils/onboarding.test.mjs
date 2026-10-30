import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOnboardingSeen } from "./onboarding.mjs";

describe("parseOnboardingSeen", () => {
  it("accepts seen true", () => {
    assert.equal(parseOnboardingSeen({ seen: true }), true);
  });

  it("accepts seen false to replay", () => {
    assert.equal(parseOnboardingSeen({ seen: false }), false);
  });

  it("treats onboardingSeenAt null as replay", () => {
    assert.equal(parseOnboardingSeen({ onboardingSeenAt: null }), false);
  });

  it("rejects a missing seen flag", () => {
    assert.throws(
      () => parseOnboardingSeen({}),
      (err) => err.statusCode === 400
    );
  });
});
