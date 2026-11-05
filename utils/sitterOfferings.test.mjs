import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapOfferingRow,
  parseOfferingInput,
  parseOfferingsBody,
  planOfferingUpsert,
} from "./sitterOfferings.mjs";

describe("parseOfferingInput", () => {
  it("accepts boarding, walks, in-home, and stay_with_pet overnight", () => {
    assert.deepEqual(parseOfferingInput({ type: "boarding", priceAmount: 1200 }), {
      type: "boarding",
      mode: null,
      durationMinutes: null,
      priceAmount: 1200,
      currency: "THB",
      isActive: true,
    });
    assert.equal(
      parseOfferingInput({
        type: "stay_with_pet",
        priceAmount: 1500,
      }).mode,
      "overnight"
    );
    assert.equal(
      parseOfferingInput({
        type: "stay_with_pet",
        priceAmount: 1500,
      }).type,
      "in_home"
    );
    assert.equal(
      parseOfferingInput({
        type: "dog_walking",
        mode: "duration",
        durationMinutes: 30,
        priceAmount: 200,
      }).durationMinutes,
      30
    );
  });

  it("rejects stay_with_pet with visit mode", () => {
    assert.throws(
      () => parseOfferingInput({ type: "stay_with_pet", mode: "visit", priceAmount: 1 }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /overnight only/);
        return true;
      }
    );
  });
});

describe("parseOfferingsBody", () => {
  it("rejects duplicates and missing array", () => {
    assert.throws(() => parseOfferingsBody({}), (err) => err.statusCode === 400);
    assert.throws(
      () =>
        parseOfferingsBody({
          offerings: [
            { type: "boarding", priceAmount: 1 },
            { type: "boarding", priceAmount: 2 },
          ],
        }),
      /duplicate/
    );
  });
});

describe("planOfferingUpsert", () => {
  it("updates matches, inserts new, deactivates omitted rows", () => {
    const existing = [
      {
        id: "keep",
        type: "boarding",
        mode: null,
        duration_minutes: null,
        price_amount: 1000,
        currency: "THB",
        is_active: true,
      },
      {
        id: "drop",
        type: "in_home",
        mode: "visit",
        duration_minutes: null,
        price_amount: 400,
        currency: "THB",
        is_active: true,
      },
    ];
    const incoming = parseOfferingsBody({
      offerings: [
        { type: "boarding", priceAmount: 1200 },
        { type: "stay_with_pet", priceAmount: 1500 },
      ],
    });
    const plan = planOfferingUpsert(existing, incoming);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].id, "keep");
    assert.equal(plan.updates[0].priceAmount, 1200);
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.inserts[0].type, "in_home");
    assert.equal(plan.inserts[0].mode, "overnight");
    assert.deepEqual(plan.deactivateIds, ["drop"]);
  });
});

describe("mapOfferingRow", () => {
  it("maps snake_case rows for the client", () => {
    assert.deepEqual(
      mapOfferingRow({
        id: "svc",
        type: "dog_walking",
        mode: "per_walk",
        duration_minutes: null,
        price_amount: "250.00",
        currency: "THB",
        is_active: true,
      }),
      {
        id: "svc",
        type: "dog_walking",
        mode: "per_walk",
        durationMinutes: null,
        priceAmount: 250,
        currency: "THB",
        isActive: true,
      }
    );
  });
});
