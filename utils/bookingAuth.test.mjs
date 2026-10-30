import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNotSelfBooking,
  assertOwnerAccess,
  assertPartyAccess,
  assertSitterAccess,
  isBookingOwner,
  isBookingSitter,
} from "./bookingAuth.mjs";

const booking = { id: "b1", owner_id: "owner-1", sitter_id: "sitter-1" };

describe("booking role checks", () => {
  it("identifies owner vs sitter vs other", () => {
    assert.equal(isBookingOwner(booking, "owner-1"), true);
    assert.equal(isBookingSitter(booking, "owner-1"), false);
    assert.equal(isBookingOwner(booking, "sitter-1"), false);
    assert.equal(isBookingSitter(booking, "sitter-1"), true);
    assert.equal(isBookingOwner(booking, "other-1"), false);
    assert.equal(isBookingSitter(booking, "other-1"), false);
  });

  it("owner detail is 404 for sitter and other", () => {
    assertOwnerAccess(booking, "owner-1");
    for (const userId of ["sitter-1", "other-1"]) {
      assert.throws(() => assertOwnerAccess(booking, userId), (err) => {
        assert.equal(err.statusCode, 404);
        return true;
      });
    }
    assert.throws(() => assertOwnerAccess(null, "owner-1"), (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it("sitter detail is 404 for owner and other", () => {
    assertSitterAccess(booking, "sitter-1");
    for (const userId of ["owner-1", "other-1"]) {
      assert.throws(() => assertSitterAccess(booking, userId), (err) => {
        assert.equal(err.statusCode, 404);
        return true;
      });
    }
  });

  it("party access allows owner and sitter only", () => {
    assertPartyAccess(booking, "owner-1");
    assertPartyAccess(booking, "sitter-1");
    assert.throws(() => assertPartyAccess(booking, "other-1"), (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it("rejects booking yourself", () => {
    assert.throws(() => assertNotSelfBooking("same", "same"), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    });
    assertNotSelfBooking("owner-1", "sitter-1");
  });
});
