import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { utcIso, utcIsoFields } from "./iso.mjs";

describe("utcIso", () => {
  it("emits UTC ISO with a Z suffix like REST", () => {
    assert.equal(utcIso("2026-10-30T02:09:08+00:00"), "2026-10-30T02:09:08.000Z");
    assert.equal(
      utcIso(new Date("2026-10-30T09:09:08+07:00")),
      "2026-10-30T02:09:08.000Z"
    );
    assert.match(utcIso("2026-10-30T02:09:08.000Z"), /Z$/);
  });
});

describe("utcIsoFields", () => {
  it("rewrites named timestamp fields", () => {
    const out = utcIsoFields(
      { recordedAt: "2026-10-30T02:09:08+00:00", lat: 13.73 },
      ["recordedAt"]
    );
    assert.equal(out.recordedAt, "2026-10-30T02:09:08.000Z");
    assert.equal(out.lat, 13.73);
  });
});
