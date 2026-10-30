import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOwnerProfileComplete } from "./validateUsers.mjs";

const completeOwner = {
  name: "Arisa Thong",
  email: "arisa.owner@petsitter.demo",
  phone: "0812345678",
  id_number: "1103700123456",
  date_of_birth: "1994-03-18",
};

describe("isOwnerProfileComplete", () => {
  it("accepts the seeded owner @petsitter.demo email", () => {
    assert.equal(isOwnerProfileComplete(completeOwner), true);
  });

  it("accepts other non-.com TLDs and .com", () => {
    assert.equal(
      isOwnerProfileComplete({ ...completeOwner, email: "owner@example.co.th" }),
      true
    );
    assert.equal(
      isOwnerProfileComplete({ ...completeOwner, email: "owner@gmail.com" }),
      true
    );
  });

  it("rejects a missing or shapeless email", () => {
    assert.equal(
      isOwnerProfileComplete({ ...completeOwner, email: "not-an-email" }),
      false
    );
    assert.equal(
      isOwnerProfileComplete({ ...completeOwner, email: "owner@" }),
      false
    );
  });
});
