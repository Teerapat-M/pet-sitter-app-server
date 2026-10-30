import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeLatLngPolyline, haversineMeters, speedMps, sumPathMeters } from "./geo.mjs";

describe("haversineMeters", () => {
  it("is 0 for the same point", () => {
    assert.equal(haversineMeters({ lat: 13.73, lng: 100.58 }, { lat: 13.73, lng: 100.58 }), 0);
  });

  it("measures 0.001° longitude at the equator as ~111.2 m", () => {
    const meters = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
    assert.ok(meters > 111 && meters < 112, meters);
  });
});

describe("sumPathMeters", () => {
  it("adds consecutive segments", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0, lng: 0.002 },
    ];
    const total = sumPathMeters(points);
    const one = haversineMeters(points[0], points[1]);
    assert.ok(Math.abs(total - one * 2) < 0.01, total);
  });
});

describe("speedMps", () => {
  it("is metres over elapsed seconds", () => {
    const from = { lat: 0, lng: 0 };
    const to = { lat: 0, lng: 0.001 };
    const meters = haversineMeters(from, to);
    const speed = speedMps(from, to, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:10.000Z");
    assert.ok(Math.abs(speed - meters / 10) < 1e-9);
  });
});

describe("encodeLatLngPolyline", () => {
  it("joins lat,lng with pipes", () => {
    assert.equal(
      encodeLatLngPolyline([
        { lat: 13.7308, lng: 100.5813 },
        { lat: 13.7312, lng: 100.582 },
      ]),
      "13.73080,100.58130|13.73120,100.58200"
    );
  });
});
