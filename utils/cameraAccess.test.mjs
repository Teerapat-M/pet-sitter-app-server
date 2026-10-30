import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCameraEnabled,
  assertOwnerLiveView,
  assertSitterCamera,
  grantCoversAt,
  isBoardingBooking,
} from "./cameraAccess.mjs";

const OWNER = "owner-1";
const SITTER = "sitter-1";
const OTHER = "other-1";
const NOW = new Date("2026-10-30T05:00:00.000Z");

function boarding(overrides = {}) {
  return {
    id: "booking-1",
    owner_id: OWNER,
    sitter_id: SITTER,
    status: "in_service",
    service_type: "boarding",
    duration_unit: "Day",
    ...overrides,
  };
}

const GRANT = {
  valid_from: new Date("2026-10-28T05:00:00.000Z"),
  valid_to: new Date("2026-11-15T05:00:00.000Z"),
};

describe("isBoardingBooking", () => {
  it("accepts service_type boarding and legacy Day/nights units", () => {
    assert.equal(isBoardingBooking(boarding()), true);
    assert.equal(isBoardingBooking(boarding({ service_type: null, duration_unit: "nights" })), true);
    assert.equal(isBoardingBooking(boarding({ service_type: "dog_walking", duration_unit: "walk" })), false);
  });
});

describe("grantCoversAt", () => {
  it("is inclusive of validFrom and validTo", () => {
    assert.equal(grantCoversAt(GRANT, GRANT.valid_from), true);
    assert.equal(grantCoversAt(GRANT, GRANT.valid_to), true);
    assert.equal(grantCoversAt(GRANT, new Date("2026-10-27T00:00:00.000Z")), false);
  });
});

describe("assertOwnerLiveView", () => {
  it("404s a user who is not the booking owner", () => {
    assert.throws(
      () => assertOwnerLiveView(boarding(), OTHER, { grant: GRANT, now: NOW }),
      (err) => err.statusCode === 404
    );
    assert.throws(
      () => assertOwnerLiveView(null, OWNER, { grant: GRANT, now: NOW }),
      (err) => err.statusCode === 404
    );
  });

  it("403s the owner for a non-boarding booking", () => {
    assert.throws(
      () =>
        assertOwnerLiveView(
          boarding({ service_type: "dog_walking", duration_unit: "walk" }),
          OWNER,
          { grant: GRANT, now: NOW }
        ),
      (err) => err.statusCode === 403 && /boarding/.test(err.message)
    );
  });

  it("403s the owner when the booking is not in_service", () => {
    assert.throws(
      () =>
        assertOwnerLiveView(boarding({ status: "waiting_service" }), OWNER, {
          grant: GRANT,
          now: NOW,
        }),
      (err) => err.statusCode === 403 && /in service/.test(err.message)
    );
  });

  it("403s the owner outside the grant window", () => {
    assert.throws(
      () =>
        assertOwnerLiveView(boarding(), OWNER, {
          grant: GRANT,
          now: new Date("2026-11-16T00:00:00.000Z"),
        }),
      (err) => err.statusCode === 403 && /window/.test(err.message)
    );
  });

  it("allows the owner during an in-service boarding window", () => {
    assert.doesNotThrow(() =>
      assertOwnerLiveView(boarding(), OWNER, { grant: GRANT, now: NOW })
    );
  });
});

describe("assertCameraEnabled / assertSitterCamera", () => {
  it("403s a disabled camera", () => {
    assert.throws(
      () => assertCameraEnabled({ is_enabled: false }),
      (err) => err.statusCode === 403
    );
  });

  it("404s another sitter's camera", () => {
    assert.throws(
      () => assertSitterCamera({ sitter_id: SITTER }, OTHER),
      (err) => err.statusCode === 404
    );
  });
});
