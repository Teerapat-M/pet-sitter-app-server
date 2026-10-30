import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOwnerCanCancel,
  assertOwnerCanReview,
  assertValidSitterTransition,
  isCompletedStatus,
} from "./bookingStatus.mjs";

describe("assertValidSitterTransition", () => {
  it("allows waiting_confirm → waiting_service (accept)", () => {
    assert.equal(
      assertValidSitterTransition("waiting_confirm", "waiting_service"),
      "waiting_service"
    );
  });

  it("allows waiting_confirm → cancelled (decline)", () => {
    assert.equal(
      assertValidSitterTransition("waiting_confirm", "cancelled"),
      "cancelled"
    );
  });

  it("allows waiting_service → in_service", () => {
    assert.equal(
      assertValidSitterTransition("waiting_service", "in_service"),
      "in_service"
    );
  });

  it("maps in_service → completed", () => {
    assert.equal(
      assertValidSitterTransition("in_service", "completed"),
      "completed"
    );
  });

  it("maps legacy in_service → success onto completed", () => {
    assert.equal(
      assertValidSitterTransition("in_service", "success"),
      "completed"
    );
  });

  it("rejects skipped and backward transitions", () => {
    const bad = [
      ["waiting_confirm", "in_service"],
      ["waiting_confirm", "completed"],
      ["waiting_service", "waiting_confirm"],
      ["waiting_service", "completed"],
      ["in_service", "waiting_service"],
      ["in_service", "cancelled"],
      ["completed", "in_service"],
      ["cancelled", "waiting_confirm"],
    ];
    for (const [from, to] of bad) {
      assert.throws(
        () => assertValidSitterTransition(from, to),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.match(err.message, /invalid status transition/i);
          return true;
        }
      );
    }
  });
});

describe("owner gates", () => {
  it("lets the owner cancel only while waiting_confirm", () => {
    assertOwnerCanCancel("waiting_confirm");
    assert.throws(() => assertOwnerCanCancel("waiting_service"), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });

  it("lets the owner review completed or legacy success", () => {
    assertOwnerCanReview("completed");
    assertOwnerCanReview("success");
    assert.equal(isCompletedStatus("completed"), true);
    assert.throws(() => assertOwnerCanReview("in_service"), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });
});
