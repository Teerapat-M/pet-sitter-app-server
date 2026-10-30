import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { createWalksService } from "./walks.service.mjs";
import { resetWalkPostRate } from "../utils/walkPoints.mjs";

const OWNER = "owner-1";
const SITTER = "sitter-1";
const OTHER = "other-1";
const BOOKING_ID = "b0000002-0002-4002-8002-000000000002";
const NOW = Date.parse("2026-10-30T02:20:00.000Z");

function dogWalkingBooking(overrides = {}) {
  return {
    id: BOOKING_ID,
    owner_id: OWNER,
    sitter_id: SITTER,
    status: "in_service",
    service_type: "dog_walking",
    duration_unit: "walk",
    pet_ids: [1],
    ...overrides,
  };
}

function liveWalk(overrides = {}) {
  return {
    id: "e0000001-0001-4001-8001-000000000001",
    booking_id: BOOKING_ID,
    walker_id: SITTER,
    pet_ids: [1],
    status: "live",
    started_at: new Date("2026-10-30T02:05:00.000Z"),
    ended_at: null,
    distance_m: 0,
    duration_s: 0,
    route_polyline: null,
    summary: null,
    ...overrides,
  };
}

function fakeRepo(state) {
  return {
    async withTransaction(fn) {
      return fn({});
    },
    async findBookingForWalk() {
      return state.booking;
    },
    async findBookingForWalkRead() {
      return state.booking;
    },
    async lockByBookingId() {
      return state.walk;
    },
    async findByBookingId() {
      return state.walk;
    },
    async insertLive({ bookingId, walkerId, petIds, startedAt }) {
      state.walk = liveWalk({
        booking_id: bookingId,
        walker_id: walkerId,
        pet_ids: petIds,
        started_at: startedAt,
      });
      return state.walk;
    },
    async markLive() {
      state.walk.status = "live";
      return state.walk;
    },
    async lastPoint() {
      return state.points.at(-1) ?? null;
    },
    async firstPoint() {
      return state.points[0] ?? null;
    },
    async insertPoints(_walkId, points) {
      const rows = points.map((point, index) => ({
        id: state.points.length + index + 1,
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy,
        recorded_at: point.recordedAt,
      }));
      state.points.push(...rows);
      return rows;
    },
    async addDistance(_id, delta) {
      state.walk.distance_m = Number(state.walk.distance_m) + delta;
      return state.walk;
    },
    async listPoints() {
      return state.points;
    },
    async listAllPoints() {
      return state.points;
    },
    async endWalk(args) {
      Object.assign(state.walk, {
        status: "ended",
        ended_at: args.endedAt,
        distance_m: args.distanceM,
        duration_s: args.durationS,
        route_polyline: args.polyline,
        summary: args.summary,
      });
      return state.walk;
    },
    async completeBooking() {
      state.booking.status = "completed";
      return { id: state.booking.id, status: "completed" };
    },
  };
}

describe("walksService authz and status gating", () => {
  beforeEach(() => resetWalkPostRate());

  it("404s start/points/end/get for a user who is not the booking party", async () => {
    const state = { booking: dogWalkingBooking(), walk: liveWalk(), points: [] };
    const service = createWalksService({ walksRepo: fakeRepo(state), now: () => NOW });
    const body = {
      lat: 13.7308,
      lng: 100.5813,
      recordedAt: "2026-10-30T02:09:00.000Z",
    };
    for (const fn of [
      () => service.startWalk(OTHER, BOOKING_ID),
      () => service.postPoints(OTHER, BOOKING_ID, body),
      () => service.endWalk(OTHER, BOOKING_ID),
      () => service.getWalk(OTHER, BOOKING_ID),
      () => service.listPoints(OTHER, BOOKING_ID),
      () => service.snapshotForStream(OTHER, BOOKING_ID),
    ]) {
      await assert.rejects(fn, (err) => err.statusCode === 404);
    }
  });

  it("404s walker writes for the owner", async () => {
    const state = { booking: dogWalkingBooking(), walk: liveWalk(), points: [] };
    const service = createWalksService({ walksRepo: fakeRepo(state), now: () => NOW });
    await assert.rejects(() => service.startWalk(OWNER, BOOKING_ID), (err) => err.statusCode === 404);
    await assert.rejects(
      () =>
        service.postPoints(OWNER, BOOKING_ID, {
          lat: 13.73,
          lng: 100.58,
          recordedAt: "2026-10-30T02:09:00.000Z",
        }),
      (err) => err.statusCode === 404
    );
    await assert.rejects(() => service.endWalk(OWNER, BOOKING_ID), (err) => err.statusCode === 404);
  });

  it("lets the owner read", async () => {
    const state = { booking: dogWalkingBooking(), walk: liveWalk(), points: [] };
    const service = createWalksService({ walksRepo: fakeRepo(state), now: () => NOW });
    const walk = await service.getWalk(OWNER, BOOKING_ID);
    assert.equal(walk.status, "live");
  });

  it("rejects start unless the booking is an in-service dog walk", async () => {
    const waiting = {
      booking: dogWalkingBooking({ status: "waiting_service" }),
      walk: null,
      points: [],
    };
    const boarding = {
      booking: dogWalkingBooking({ service_type: "boarding", duration_unit: "nights" }),
      walk: null,
      points: [],
    };
    await assert.rejects(
      () =>
        createWalksService({ walksRepo: fakeRepo(waiting), now: () => NOW }).startWalk(
          SITTER,
          BOOKING_ID
        ),
      (err) => err.statusCode === 400
    );
    await assert.rejects(
      () =>
        createWalksService({ walksRepo: fakeRepo(boarding), now: () => NOW }).startWalk(
          SITTER,
          BOOKING_ID
        ),
      (err) => err.statusCode === 400
    );
  });

  it("starts a live walk and is idempotent while live", async () => {
    const state = { booking: dogWalkingBooking(), walk: null, points: [] };
    const service = createWalksService({ walksRepo: fakeRepo(state), now: () => NOW });
    const first = await service.startWalk(SITTER, BOOKING_ID);
    assert.equal(first.status, "live");
    const second = await service.startWalk(SITTER, BOOKING_ID);
    assert.equal(second.id, first.id);
  });

  it("rejects points before start and after the booking leaves in_service", async () => {
    const notStarted = {
      booking: dogWalkingBooking(),
      walk: null,
      points: [],
    };
    await assert.rejects(
      () =>
        createWalksService({ walksRepo: fakeRepo(notStarted), now: () => NOW }).postPoints(
          SITTER,
          BOOKING_ID,
          { lat: 13.73, lng: 100.58, recordedAt: "2026-10-30T02:09:00.000Z" }
        ),
      (err) => err.statusCode === 400
    );

    const completed = {
      booking: dogWalkingBooking({ status: "completed" }),
      walk: liveWalk(),
      points: [],
    };
    await assert.rejects(
      () =>
        createWalksService({ walksRepo: fakeRepo(completed), now: () => NOW }).postPoints(
          SITTER,
          BOOKING_ID,
          { lat: 13.73, lng: 100.58, recordedAt: "2026-10-30T02:09:00.000Z" }
        ),
      (err) => err.statusCode === 400
    );
  });

  it("accepts a batch and skips a speed outlier", async () => {
    const state = { booking: dogWalkingBooking(), walk: liveWalk(), points: [] };
    const service = createWalksService({ walksRepo: fakeRepo(state), now: () => NOW });
    const result = await service.postPoints(SITTER, BOOKING_ID, {
      points: [
        { lat: 13.7308, lng: 100.5813, recordedAt: "2026-10-30T02:09:00.000Z" },
        { lat: 13.7309, lng: 100.5814, recordedAt: "2026-10-30T02:09:08.000Z" },
        { lat: 18.0, lng: 99.0, recordedAt: "2026-10-30T02:09:16.000Z" },
      ],
    });
    assert.equal(result.accepted, 2);
    assert.equal(result.skipped, 1);
    assert.ok(result.distanceM > 0);
  });

  it("ends the walk, stores distance/duration, and completes the booking", async () => {
    const state = {
      booking: dogWalkingBooking(),
      walk: liveWalk(),
      points: [
        {
          id: 1,
          lat: 0,
          lng: 0,
          accuracy: 5,
          recorded_at: new Date("2026-10-30T02:05:00.000Z"),
        },
        {
          id: 2,
          lat: 0,
          lng: 0.001,
          accuracy: 5,
          recorded_at: new Date("2026-10-30T02:10:00.000Z"),
        },
      ],
    };
    const service = createWalksService({ walksRepo: fakeRepo(state), now: () => NOW });
    const ended = await service.endWalk(SITTER, BOOKING_ID);
    assert.equal(ended.status, "ended");
    assert.equal(state.booking.status, "completed");
    assert.ok(ended.distanceM > 111 && ended.distanceM < 112);
    assert.equal(ended.durationS, 15 * 60);
    assert.match(ended.summary, /km/);
    assert.ok(ended.start);
    assert.ok(ended.end);
  });

  it("returns history points and summary for owner and sitter", async () => {
    const state = {
      booking: dogWalkingBooking(),
      walk: liveWalk({ distance_m: 50, duration_s: 120 }),
      points: [
        {
          id: 1,
          lat: 13.73,
          lng: 100.58,
          accuracy: 4,
          recorded_at: new Date("2026-10-30T02:05:00.000Z"),
        },
      ],
    };
    const service = createWalksService({ walksRepo: fakeRepo(state), now: () => NOW });
    for (const userId of [OWNER, SITTER]) {
      const history = await service.listPoints(userId, BOOKING_ID);
      assert.equal(history.points.length, 1);
      assert.equal(history.summary.start.lat, 13.73);
      assert.equal(history.walk.id, state.walk.id);
    }
  });
});
