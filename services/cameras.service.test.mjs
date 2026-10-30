import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { createCamerasService } from "./cameras.service.mjs";
import {
  handleCameraNotification,
  resetCameraClients,
  subscribeCameraEvents,
  getCameraSession,
} from "./cameraEvents.mjs";
import {
  MAX_SIGNAL_BYTES,
  PG_NOTIFY_LIMIT_BYTES,
  SIGNAL_TTL_MS,
  resetCameraSignalRate,
  utf8ByteLength,
} from "../utils/cameraSignal.mjs";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";

const OWNER = "a1111111-1111-4111-8111-111111111111";
const SITTER = "a2222222-2222-4222-8222-222222222222";
const OTHER = "a9999999-9999-4999-8999-999999999999";
const BOOKING_ID = "b0000001-0001-4001-8001-000000000001";
const WALK_BOOKING_ID = "b0000002-0002-4002-8002-000000000002";
const CAMERA_ID = "ca000001-0001-4001-8001-000000000001";
const OTHER_CAMERA_ID = "ca000001-0001-4001-8001-000000000002";
const HOME_VENUE = "ve000001-0001-4001-8001-000000000001";
const OTHER_VENUE = "ve000001-0001-4001-8001-000000000002";
const NOW = new Date("2026-10-30T05:00:00.000Z");
const TURN_SECRET = "test-turn-secret";

function boarding(overrides = {}) {
  return {
    id: BOOKING_ID,
    owner_id: OWNER,
    sitter_id: SITTER,
    status: "in_service",
    service_type: "boarding",
    duration_unit: "Day",
    ...overrides,
  };
}

function cameraRow(overrides = {}) {
  return {
    id: CAMERA_ID,
    sitter_id: SITTER,
    venue_id: null,
    name: "Living room",
    is_enabled: true,
    status: "online",
    last_seen_at: NOW,
    ...overrides,
  };
}

function grantRow(overrides = {}) {
  return {
    ...cameraRow(),
    camera_id: CAMERA_ID,
    booking_id: BOOKING_ID,
    owner_id: OWNER,
    valid_from: new Date("2026-10-28T05:00:00.000Z"),
    valid_to: new Date("2026-11-15T05:00:00.000Z"),
    ...overrides,
  };
}

function fakeRepo(state) {
  return {
    async notify() {
      state.notified.push(...arguments);
    },
    async listBySitterId(sitterId) {
      return state.cameras.filter((row) => row.sitter_id === sitterId);
    },
    async findById(id) {
      return state.cameras.find((row) => row.id === id) ?? null;
    },
    async insert({ sitterId, name, venueId }) {
      const row = cameraRow({
        id: "ca000001-0001-4001-8001-000000000099",
        sitter_id: sitterId,
        name,
        venue_id: venueId,
        status: "offline",
        last_seen_at: null,
      });
      state.cameras.push(row);
      return row;
    },
    async update(id, patch) {
      const row = state.cameras.find((item) => item.id === id);
      if (!row) return null;
      if (patch.name != null) row.name = patch.name;
      if (patch.isEnabled != null) row.is_enabled = patch.isEnabled;
      if (patch.status != null) row.status = patch.status;
      return row;
    },
    async remove(id) {
      const index = state.cameras.findIndex((row) => row.id === id);
      if (index < 0) return null;
      const [row] = state.cameras.splice(index, 1);
      return row;
    },
    async heartbeat(id, { lastSeenAt, status }) {
      const row = state.cameras.find((item) => item.id === id);
      row.last_seen_at = lastSeenAt;
      row.status = status;
      return row;
    },
    async findBookingForCamera(id) {
      return state.bookings[id] ?? null;
    },
    async listGrantsForBooking(id) {
      return state.grants.filter((row) => row.booking_id === id);
    },
    async findGrant(bookingId, cameraId) {
      return (
        state.grants.find(
          (row) => row.booking_id === bookingId && row.camera_id === cameraId
        ) ?? null
      );
    },
    async insertSignal({ sessionId, cameraId, bookingId, payload }) {
      const cutoff = Date.now() - SIGNAL_TTL_MS;
      state.signals = state.signals.filter(
        (row) => new Date(row.created_at).getTime() >= cutoff
      );
      const row = {
        id: `sig-${state.signals.length + 1}`,
        session_id: sessionId,
        camera_id: cameraId,
        booking_id: bookingId,
        payload,
        created_at: new Date(),
      };
      state.signals.push(row);
      return row;
    },
    async findSignal(id) {
      return state.signals.find((row) => row.id === id) ?? null;
    },
    async deleteExpiredSignals() {
      const cutoff = Date.now() - SIGNAL_TTL_MS;
      const before = state.signals.length;
      state.signals = state.signals.filter(
        (row) => new Date(row.created_at).getTime() >= cutoff
      );
      return before - state.signals.length;
    },
  };
}

function mockReqRes() {
  const req = new EventEmitter();
  const chunks = [];
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = {};
  res.setHeader = (key, value) => {
    res.headers[key] = value;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.flushHeaders = () => {
    res.flushed = true;
  };
  res.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  res.chunks = chunks;
  return { req, res };
}

describe("camerasService auth matrix", () => {
  let state;
  let service;
  let notified;

  beforeEach(() => {
    resetCameraSignalRate();
    resetCameraClients();
    notified = [];
    state = {
      notified,
      signals: [],
      cameras: [cameraRow()],
      bookings: {
        [BOOKING_ID]: boarding(),
        [WALK_BOOKING_ID]: boarding({
          id: WALK_BOOKING_ID,
          service_type: "dog_walking",
          duration_unit: "walk",
        }),
      },
      grants: [grantRow()],
    };
    const repo = fakeRepo(state);
    service = createCamerasService({
      camerasRepo: repo,
      notify: async (payload) => {
        notified.push(payload);
        await handleCameraNotification(JSON.stringify(payload), {
          getSignal: (id) => repo.findSignal(id),
        });
      },
      now: () => NOW,
    });
  });

  it("lists cameras for the sitter and 404s another sitter", async () => {
    const mine = await service.listMine(SITTER);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].isEnabled, true);
    await assert.rejects(() => service.getMine(OTHER, CAMERA_ID), (err) => err.statusCode === 404);
  });

  it("lets the sitter disable a camera and ends live sessions", async () => {
    const { req, res } = mockReqRes();
    subscribeCameraEvents(
      { userId: OWNER, bookingId: BOOKING_ID, cameraIds: new Set([CAMERA_ID]) },
      req,
      res,
      { type: "snapshot" }
    );
    await service.postViewerSignal(OWNER, BOOKING_ID, CAMERA_ID, {
      type: "offer",
      sessionId: "sess-1",
      sdp: "v=0",
    });
    assert.ok(getCameraSession("sess-1"));
    const updated = await service.update(SITTER, CAMERA_ID, { isEnabled: false });
    assert.equal(updated.isEnabled, false);
    assert.equal(getCameraSession("sess-1"), null);
    assert.match(res.chunks.at(-1), /session-ended/);
    assert.match(res.chunks.at(-1), /camera_disabled/);
  });

  it("returns cameras + access window for an in-service boarding owner", async () => {
    const data = await service.listForBooking(OWNER, BOOKING_ID);
    assert.equal(data.cameras.length, 1);
    assert.equal(data.access.canView, true);
    assert.equal(data.access.validTo, "2026-11-15T05:00:00.000Z");
    assert.match(data.cameras[0].lastSeenAt, /Z$/);
  });

  it("404s a user who is not the booking party", async () => {
    await assert.rejects(
      () => service.listForBooking(OTHER, BOOKING_ID),
      (err) => err.statusCode === 404
    );
    await assert.rejects(
      () =>
        service.postViewerSignal(OTHER, BOOKING_ID, CAMERA_ID, {
          type: "offer",
          sessionId: "s",
          sdp: "v=0",
        }),
      (err) => err.statusCode === 404
    );
  });

  it("403s the owner of a non-boarding booking", async () => {
    state.bookings[WALK_BOOKING_ID] = boarding({
      id: WALK_BOOKING_ID,
      service_type: "dog_walking",
      duration_unit: "walk",
    });
    await assert.rejects(
      () => service.listForBooking(OWNER, WALK_BOOKING_ID),
      (err) => err.statusCode === 403 && /boarding/.test(err.message)
    );
  });

  it("403s the owner when the booking is not in_service", async () => {
    state.bookings[BOOKING_ID] = boarding({ status: "waiting_service" });
    await assert.rejects(
      () => service.listForBooking(OWNER, BOOKING_ID),
      (err) => err.statusCode === 403 && /in service/.test(err.message)
    );
  });

  it("403s the owner outside the grant window", async () => {
    service = createCamerasService({
      camerasRepo: fakeRepo(state),
      notify: async (payload) => notified.push(payload),
      now: () => new Date("2026-11-16T00:00:00.000Z"),
    });
    await assert.rejects(
      () => service.listForBooking(OWNER, BOOKING_ID),
      (err) => err.statusCode === 403 && /window/.test(err.message)
    );
  });

  it("403s signalling a disabled camera", async () => {
    state.grants[0].is_enabled = false;
    await assert.rejects(
      () =>
        service.postViewerSignal(OWNER, BOOKING_ID, CAMERA_ID, {
          type: "offer",
          sessionId: "sess-2",
          sdp: "v=0",
        }),
      (err) => err.statusCode === 403 && /disabled/.test(err.message)
    );
  });

  it("relays viewer offer to the publisher over SSE", async () => {
    const { req, res } = mockReqRes();
    subscribeCameraEvents({ userId: SITTER, sitterId: SITTER }, req, res, {
      type: "snapshot",
    });
    await service.postViewerSignal(OWNER, BOOKING_ID, CAMERA_ID, {
      type: "offer",
      sessionId: "sess-live",
      sdp: "v=0-offer",
    });
    assert.match(res.chunks.at(-1), /"kind":"offer"/);
    assert.match(res.chunks.at(-1), /v=0-offer/);
    await service.postPublisherSignal(SITTER, CAMERA_ID, {
      type: "answer",
      sessionId: "sess-live",
      sdp: "v=0-answer",
    });
    const owner = mockReqRes();
    subscribeCameraEvents(
      { userId: OWNER, bookingId: BOOKING_ID, cameraIds: new Set([CAMERA_ID]) },
      owner.req,
      owner.res,
      { type: "snapshot" }
    );
    await service.postPublisherSignal(SITTER, CAMERA_ID, {
      type: "ice",
      sessionId: "sess-live",
      candidate: { candidate: "candidate:1", sdpMid: "0" },
    });
    assert.match(owner.res.chunks.at(-1), /"kind":"ice"/);
  });

  it("relays a ~10KB SDP end-to-end via NOTIFY ref (under PG 8000)", async () => {
    const sdp = `v=0\n${"x".repeat(10 * 1024)}`;
    assert.ok(Buffer.byteLength(sdp, "utf8") > 10_000);
    const { req, res } = mockReqRes();
    subscribeCameraEvents({ userId: SITTER, sitterId: SITTER }, req, res, {
      type: "snapshot",
    });
    await service.postViewerSignal(OWNER, BOOKING_ID, CAMERA_ID, {
      type: "offer",
      sessionId: "sess-10k",
      sdp,
    });
    const ref = notified.at(-1);
    assert.equal(ref.type, "signal-ref");
    assert.ok(ref.signalId);
    assert.equal(ref.sdp, undefined);
    assert.ok(utf8ByteLength(ref) < PG_NOTIFY_LIMIT_BYTES);
    const chunk = res.chunks.find((row) => row.includes("sess-10k"));
    assert.ok(chunk, "publisher SSE should receive the full offer");
    assert.ok(chunk.includes("x".repeat(64)));
    assert.match(chunk, /"kind":"offer"/);
  });

  it("413s a signalling body over 16KB", async () => {
    const sdp = "x".repeat(MAX_SIGNAL_BYTES);
    await assert.rejects(
      () =>
        service.postViewerSignal(OWNER, BOOKING_ID, CAMERA_ID, {
          type: "offer",
          sessionId: "sess-too-big",
          sdp,
        }),
      (err) => err.statusCode === 413
    );
    assert.equal(
      notified.filter((row) => row.type === "signal-ref").length,
      0
    );
  });

  it("marks the camera online on heartbeat", async () => {
    state.cameras[0].status = "offline";
    const row = await service.heartbeat(SITTER, CAMERA_ID);
    assert.equal(row.status, "online");
    assert.equal(row.lastSeenAt, NOW.toISOString());
  });

  it("hides cameras at another venue and 403s signalling a mismatch", async () => {
    state.bookings[BOOKING_ID] = boarding({ venue_id: HOME_VENUE });
    state.cameras.push(
      cameraRow({ id: OTHER_CAMERA_ID, venue_id: OTHER_VENUE, name: "Other home" })
    );
    state.grants.push(
      grantRow({
        id: OTHER_CAMERA_ID,
        camera_id: OTHER_CAMERA_ID,
        venue_id: OTHER_VENUE,
        name: "Other home",
      })
    );
    state.grants[0].venue_id = HOME_VENUE;
    state.cameras[0].venue_id = HOME_VENUE;

    const data = await service.listForBooking(OWNER, BOOKING_ID);
    assert.equal(data.cameras.length, 1);
    assert.equal(data.cameras[0].id, CAMERA_ID);

    await assert.rejects(
      () =>
        service.postViewerSignal(OWNER, BOOKING_ID, OTHER_CAMERA_ID, {
          type: "offer",
          sessionId: "sess-venue",
          sdp: "v=0",
        }),
      (err) => err.statusCode === 403 && /venue/.test(err.message)
    );
  });

  it("429s a third live session from the same owner on one camera", async () => {
    await service.postViewerSignal(OWNER, BOOKING_ID, CAMERA_ID, {
      type: "offer",
      sessionId: "sess-a",
      sdp: "v=0",
    });
    await service.postViewerSignal(OWNER, BOOKING_ID, CAMERA_ID, {
      type: "offer",
      sessionId: "sess-b",
      sdp: "v=0",
    });
    await assert.rejects(
      () =>
        service.postViewerSignal(OWNER, BOOKING_ID, CAMERA_ID, {
          type: "offer",
          sessionId: "sess-c",
          sdp: "v=0",
        }),
      (err) => err.statusCode === 429 && /sessions/.test(err.message)
    );
  });

  it("gates GET ICE on cameraId or bookingId", async () => {
    await assert.rejects(() => service.iceFor(OWNER, {}), (err) => err.statusCode === 400);
    await assert.rejects(
      () => service.iceFor(OTHER, { cameraId: CAMERA_ID }),
      (err) => err.statusCode === 404
    );
    await assert.rejects(
      () => service.iceFor(OWNER, { bookingId: WALK_BOOKING_ID }),
      (err) => err.statusCode === 403
    );
  });

  it("issues HMAC TURN creds to the camera sitter and a granted owner", async () => {
    const env = {
      TURN_URLS: "turn:turn.example.com:3478",
      TURN_SECRET,
      TURN_USERNAME: "static-user",
      TURN_CREDENTIAL: "static-pass",
    };
    const sitterIce = await service.iceFor(SITTER, { cameraId: CAMERA_ID }, env);
    const expiry = Math.floor(NOW.getTime() / 1000) + 300;
    const username = `${expiry}:${SITTER}`;
    assert.equal(sitterIce.iceServers[1].username, username);
    assert.equal(
      sitterIce.iceServers[1].credential,
      createHmac("sha1", TURN_SECRET).update(username).digest("base64")
    );
    assert.notEqual(sitterIce.iceServers[1].username, "static-user");

    const ownerIce = await service.iceFor(OWNER, { bookingId: BOOKING_ID }, env);
    const ownerUser = `${expiry}:${OWNER}`;
    assert.equal(ownerIce.iceServers[1].username, ownerUser);
    assert.equal(
      ownerIce.iceServers[1].credential,
      createHmac("sha1", TURN_SECRET).update(ownerUser).digest("base64")
    );
  });

  it("403s ICE for a disabled camera on sitter and owner paths", async () => {
    state.cameras[0].is_enabled = false;
    state.grants[0].is_enabled = false;
    await assert.rejects(
      () => service.iceFor(SITTER, { cameraId: CAMERA_ID }),
      (err) => err.statusCode === 403 && /disabled/.test(err.message)
    );
    await assert.rejects(
      () => service.iceFor(OWNER, { bookingId: BOOKING_ID, cameraId: CAMERA_ID }),
      (err) => err.statusCode === 403 && /disabled/.test(err.message)
    );
    await assert.rejects(
      () => service.iceFor(OWNER, { bookingId: BOOKING_ID }),
      (err) => err.statusCode === 403 && /disabled/.test(err.message)
    );
  });

  it("403s ICE when the camera is not at the booking venue", async () => {
    state.bookings[BOOKING_ID] = boarding({ venue_id: HOME_VENUE });
    state.grants[0].venue_id = OTHER_VENUE;
    await assert.rejects(
      () => service.iceFor(OWNER, { bookingId: BOOKING_ID, cameraId: CAMERA_ID }),
      (err) => err.statusCode === 403 && /venue/.test(err.message)
    );
  });
});
