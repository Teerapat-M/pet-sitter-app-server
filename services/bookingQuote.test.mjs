import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMinutesToTime,
  assertDogsOnly,
  assertNoConflict,
  buildServiceQuote,
  hasConflict,
  requireInHomeAddress,
  resolveReschedulePricing,
  resolveServiceWindow,
} from "./bookingQuote.mjs";

const offerings = [
  {
    id: "svc-board",
    type: "boarding",
    mode: null,
    duration_minutes: null,
    price_amount: 1200,
    currency: "THB",
  },
  {
    id: "svc-walk-30",
    type: "dog_walking",
    mode: "duration",
    duration_minutes: 30,
    price_amount: 200,
    currency: "THB",
  },
  {
    id: "svc-walk",
    type: "dog_walking",
    mode: "per_walk",
    duration_minutes: null,
    price_amount: 250,
    currency: "THB",
  },
  {
    id: "svc-visit",
    type: "in_home",
    mode: "visit",
    duration_minutes: null,
    price_amount: 450,
    currency: "THB",
  },
  {
    id: "svc-over",
    type: "in_home",
    mode: "overnight",
    duration_minutes: null,
    price_amount: 1400,
    currency: "THB",
  },
];

describe("resolveServiceWindow", () => {
  it("boards from check-in to check-out at 12:00", () => {
    assert.deepEqual(
      resolveServiceWindow({
        serviceType: "boarding",
        checkIn: "2026-11-01",
        checkOut: "2026-11-05",
      }),
      {
        serviceType: "boarding",
        mode: null,
        durationMinutes: null,
        startDate: "2026-11-01",
        endDate: "2026-11-05",
        startTime: "12:00",
        endTime: "12:00",
        duration: 4,
        durationUnit: "nights",
        nights: 4,
        hours: null,
      }
    );
  });

  it("walks a 30 minute slot from startTime", () => {
    const window = resolveServiceWindow({
      serviceType: "dog_walking",
      mode: "duration",
      date: "2026-11-02",
      startTime: "09:00",
      durationMinutes: 30,
    });
    assert.equal(window.endTime, "09:30");
    assert.equal(window.duration, 30);
    assert.equal(window.durationUnit, "minutes");
  });

  it("walks 60 minutes for duration mode", () => {
    const window = resolveServiceWindow({
      serviceType: "dog_walking",
      date: "2026-11-02",
      startTime: "09:00",
      durationMinutes: 60,
    });
    assert.equal(window.mode, "duration");
    assert.equal(window.endTime, "10:00");
  });

  it("in-home visit uses hours", () => {
    const window = resolveServiceWindow({
      serviceType: "in_home",
      mode: "visit",
      date: "2026-11-02",
      startTime: "13:00",
      visitHours: 2,
    });
    assert.equal(window.endTime, "15:00");
    assert.equal(window.hours, 2);
    assert.equal(window.durationUnit, "hours");
  });

  it("in-home overnight uses nights", () => {
    const window = resolveServiceWindow({
      serviceType: "in_home",
      mode: "overnight",
      checkIn: "2026-11-02",
      checkOut: "2026-11-04",
    });
    assert.equal(window.nights, 2);
    assert.equal(window.durationUnit, "nights");
  });
});

describe("buildServiceQuote", () => {
  it("prices boarding from the offering and ignores a client total", () => {
    const quote = buildServiceQuote(
      {
        serviceType: "boarding",
        checkIn: "2026-11-01",
        checkOut: "2026-11-05",
        totalPrice: 1,
      },
      offerings,
      { petCount: 2, hasCctv: true }
    );
    assert.equal(quote.totalPrice, 4800);
    assert.equal(quote.unitPrice, 1200);
    assert.equal(quote.hasCctv, true);
    assert.equal(quote.serviceId, "svc-board");
  });

  it("prices a 30 minute walk", () => {
    const quote = buildServiceQuote(
      {
        serviceType: "dog_walking",
        mode: "duration",
        date: "2026-11-02",
        startTime: "09:00",
        durationMinutes: 30,
        totalPrice: 9999,
      },
      offerings,
      { petCount: 1 }
    );
    assert.equal(quote.totalPrice, 200);
    assert.equal(quote.hasCctv, false);
  });

  it("prices a per-walk offering", () => {
    const quote = buildServiceQuote(
      {
        serviceType: "dog_walking",
        mode: "per_walk",
        date: "2026-11-02",
        startTime: "09:00",
      },
      offerings
    );
    assert.equal(quote.totalPrice, 250);
  });

  it("prices an in-home visit by hours", () => {
    const quote = buildServiceQuote(
      {
        serviceType: "in_home",
        mode: "visit",
        date: "2026-11-02",
        startTime: "13:00",
        visitHours: 3,
      },
      offerings
    );
    assert.equal(quote.totalPrice, 1350);
  });

  it("prices in-home overnight by nights", () => {
    const quote = buildServiceQuote(
      {
        serviceType: "in_home",
        mode: "overnight",
        checkIn: "2026-11-02",
        checkOut: "2026-11-03",
      },
      offerings
    );
    assert.equal(quote.totalPrice, 1400);
  });

  it("404s when the sitter has no matching offering", () => {
    assert.throws(
      () =>
        buildServiceQuote(
          {
            serviceType: "boarding",
            checkIn: "2026-11-01",
            checkOut: "2026-11-02",
          },
          []
        ),
      (err) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });
});

describe("conflicts", () => {
  const boarding = {
    startDate: "2026-11-01",
    endDate: "2026-11-05",
    startTime: "12:00",
    endTime: "12:00",
  };

  it("blocks overlapping boarding nights", () => {
    assert.equal(
      hasConflict([boarding], {
        startDate: "2026-11-04",
        endDate: "2026-11-07",
        startTime: "12:00",
        endTime: "12:00",
      }),
      true
    );
    assert.throws(
      () =>
        assertNoConflict([boarding], {
          startDate: "2026-11-04",
          endDate: "2026-11-07",
          startTime: "12:00",
          endTime: "12:00",
        }),
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  it("allows a booking that starts on checkout day", () => {
    assert.equal(
      hasConflict([boarding], {
        startDate: "2026-11-05",
        endDate: "2026-11-07",
        startTime: "12:00",
        endTime: "12:00",
      }),
      false
    );
  });

  it("blocks overlapping walk slots on the same day", () => {
    const walk = {
      startDate: "2026-11-02",
      endDate: "2026-11-02",
      startTime: "09:00",
      endTime: "10:00",
    };
    assert.equal(
      hasConflict([walk], {
        startDate: "2026-11-02",
        endDate: "2026-11-02",
        startTime: "09:30",
        endTime: "10:00",
      }),
      true
    );
    assert.equal(
      hasConflict([walk], {
        startDate: "2026-11-02",
        endDate: "2026-11-02",
        startTime: "10:00",
        endTime: "10:30",
      }),
      false
    );
  });
});

describe("dogs only and in-home address", () => {
  it("rejects cats on a walk", () => {
    assert.throws(
      () => assertDogsOnly([{ pet_type: "Cat" }]),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /dogs only/i);
        return true;
      }
    );
    assertDogsOnly([{ pet_type: "Dog" }]);
  });

  it("requires ownerAddress for in-home create", () => {
    assert.throws(
      () => requireInHomeAddress({}, "in_home"),
      (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
    assert.deepEqual(
      requireInHomeAddress({ ownerAddress: "12 Sukhumvit" }, "in_home"),
      { ownerAddress: "12 Sukhumvit", accessInstructions: null }
    );
    assert.deepEqual(requireInHomeAddress({}, "boarding"), {
      ownerAddress: null,
      accessInstructions: null,
    });
  });
});

describe("resolveReschedulePricing", () => {
  it("recomputes boarding from the offering (2 nights × 1200 = 2400)", () => {
    const result = resolveReschedulePricing(
      {
        service_id: "svc-board",
        service_type: "boarding",
        service_mode: null,
        service_duration_minutes: null,
        service_unit_price: 1200,
        pet_count: 1,
        start_time: "12:00",
        end_time: "12:00",
      },
      { checkIn: "2026-11-01", checkOut: "2026-11-03" }
    );
    assert.equal(result.totalPrice, 2400);
    assert.equal(result.duration, 2);
    assert.equal(result.durationUnit, "nights");
    assert.equal(result.startDate, "2026-11-01");
    assert.equal(result.endDate, "2026-11-03");
  });

  it("keeps legacy nightly rates when there is no service_id", () => {
    const result = resolveReschedulePricing(
      { pet_count: 1 },
      { startDate: "2026-11-01", endDate: "2026-11-03" }
    );
    assert.equal(result.totalPrice, 2000);
    assert.equal(result.durationUnit, "Day");
  });
});

describe("addMinutesToTime", () => {
  it("adds a 30 minute slot", () => {
    assert.equal(addMinutesToTime("09:00", 30), "09:30");
    assert.equal(addMinutesToTime("23:00", 60), "23:59");
  });
});
