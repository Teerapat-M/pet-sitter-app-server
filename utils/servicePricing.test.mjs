import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  priceBoarding,
  priceDogWalking,
  priceInHomeOvernight,
  priceInHomeVisit,
  priceServiceOffering,
} from "./servicePricing.mjs";

describe("priceBoarding", () => {
  it("4 nights × 1200 = 4800", () => {
    assert.equal(priceBoarding({ nights: 4, unitPrice: 1200 }), 4800);
  });

  it("rejects zero nights", () => {
    assert.throws(() => priceBoarding({ nights: 0, unitPrice: 1200 }), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });
});

describe("priceDogWalking", () => {
  it("uses the per-walk offering price", () => {
    assert.equal(priceDogWalking({ unitPrice: 250 }), 250);
  });

  it("uses the 30/60 minute offering price as-is", () => {
    assert.equal(priceDogWalking({ unitPrice: 200 }), 200);
    assert.equal(priceDogWalking({ unitPrice: 350 }), 350);
  });
});

describe("priceInHomeVisit", () => {
  it("3 hours × 450 = 1350", () => {
    assert.equal(priceInHomeVisit({ hours: 3, unitPrice: 450 }), 1350);
  });
});

describe("priceInHomeOvernight", () => {
  it("2 nights × 1400 = 2800", () => {
    assert.equal(priceInHomeOvernight({ nights: 2, unitPrice: 1400 }), 2800);
  });
});

describe("priceServiceOffering", () => {
  it("routes by type and mode", () => {
    assert.equal(
      priceServiceOffering({
        type: "boarding",
        nights: 2,
        unitPrice: 1200,
      }),
      2400
    );
    assert.equal(
      priceServiceOffering({
        type: "dog_walking",
        mode: "duration",
        unitPrice: 200,
      }),
      200
    );
    assert.equal(
      priceServiceOffering({
        type: "in_home",
        mode: "visit",
        hours: 2,
        unitPrice: 450,
      }),
      900
    );
    assert.equal(
      priceServiceOffering({
        type: "in_home",
        mode: "overnight",
        nights: 1,
        unitPrice: 1500,
      }),
      1500
    );
  });
});
