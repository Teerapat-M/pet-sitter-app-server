import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  assertWalkPostRate,
  filterWalkPoints,
  incrementalDistanceM,
  normalizeWalkPointsBody,
  parseWalkPoint,
  resetWalkPostRate,
} from "./walkPoints.mjs";

const now = Date.parse("2026-10-30T02:10:00.000Z");

describe("parseWalkPoint", () => {
  it("accepts lat/lng/accuracy/recordedAt", () => {
    const point = parseWalkPoint(
      {
        lat: 13.73,
        lng: 100.58,
        accuracy: 6,
        recordedAt: "2026-10-30T02:09:50.000Z",
      },
      now
    );
    assert.equal(point.lat, 13.73);
    assert.equal(point.lng, 100.58);
    assert.equal(point.accuracy, 6);
  });

  it("rejects out-of-range coordinates", () => {
    assert.throws(
      () => parseWalkPoint({ lat: 91, lng: 0 }, now),
      (err) => err.statusCode === 400
    );
    assert.throws(
      () => parseWalkPoint({ lat: 0, lng: 181 }, now),
      (err) => err.statusCode === 400
    );
  });

  it("rejects timestamps too far in the future", () => {
    assert.throws(
      () =>
        parseWalkPoint(
          { lat: 0, lng: 0, recordedAt: "2026-10-30T02:11:00.000Z" },
          now
        ),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /future/i);
        return true;
      }
    );
  });
});

describe("normalizeWalkPointsBody", () => {
  it("accepts a single point or a points array", () => {
    assert.equal(normalizeWalkPointsBody({ lat: 1, lng: 2 }).length, 1);
    assert.equal(
      normalizeWalkPointsBody({ points: [{ lat: 1, lng: 2 }, { lat: 1.1, lng: 2.1 }] }).length,
      2
    );
  });
});

describe("filterWalkPoints", () => {
  const startedAt = "2026-10-30T02:00:00.000Z";

  it("keeps a 5–10s walking pair and skips a teleport", () => {
    const { accepted, skipped } = filterWalkPoints(
      [
        { lat: 13.7308, lng: 100.5813, recordedAt: "2026-10-30T02:09:00.000Z" },
        { lat: 13.7309, lng: 100.5814, recordedAt: "2026-10-30T02:09:08.000Z" },
        { lat: 14.5, lng: 101.5, recordedAt: "2026-10-30T02:09:16.000Z" },
      ],
      { startedAt, now }
    );
    assert.equal(accepted.length, 2);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].reason, "speed outlier");
  });

  it("skips points closer than 2 seconds", () => {
    const { accepted, skipped } = filterWalkPoints(
      [
        { lat: 13.7308, lng: 100.5813, recordedAt: "2026-10-30T02:09:00.000Z" },
        { lat: 13.73081, lng: 100.58131, recordedAt: "2026-10-30T02:09:01.000Z" },
      ],
      { startedAt, now }
    );
    assert.equal(accepted.length, 1);
    assert.equal(skipped[0].reason, "points must be at least 2 seconds apart");
  });

  it("400s when every point is invalid", () => {
    assert.throws(
      () =>
        filterWalkPoints([{ lat: 200, lng: 0, recordedAt: "2026-10-30T02:09:00.000Z" }], {
          startedAt,
          now,
        }),
      (err) => err.statusCode === 400
    );
  });
});

describe("incrementalDistanceM", () => {
  it("adds distance from the last stored point", () => {
    const last = { lat: 0, lng: 0 };
    const accepted = [{ lat: 0, lng: 0.001 }];
    const meters = incrementalDistanceM(last, accepted);
    assert.ok(meters > 111 && meters < 112, meters);
  });
});

describe("assertWalkPostRate", () => {
  beforeEach(() => resetWalkPostRate());

  it("allows a burst then 429s", () => {
    for (let i = 0; i < 20; i += 1) {
      assertWalkPostRate("walk-1", now);
    }
    assert.throws(
      () => assertWalkPostRate("walk-1", now),
      (err) => err.statusCode === 429
    );
  });
});
