import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it, beforeEach } from "node:test";
import {
  expireCameraSessions,
  handleCameraNotification,
  normalizeCameraSsePayload,
  openCameraSession,
  publishCameraEvent,
  resetCameraClients,
  subscribeCameraEvents,
} from "./cameraEvents.mjs";

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

describe("camera SSE", () => {
  beforeEach(() => resetCameraClients());

  it("normalizes lastSeenAt to UTC ISO with Z", () => {
    const out = normalizeCameraSsePayload({
      type: "camera:status",
      lastSeenAt: "2026-10-30T05:00:00+00:00",
    });
    assert.equal(out.lastSeenAt, "2026-10-30T05:00:00.000Z");
  });

  it("fans camera:status to the booking owner, not another booking", async () => {
    const owner = mockReqRes();
    const other = mockReqRes();
    subscribeCameraEvents(
      { userId: "owner", bookingId: "b1", cameraIds: new Set(["c1"]) },
      owner.req,
      owner.res
    );
    subscribeCameraEvents(
      { userId: "owner", bookingId: "b2", cameraIds: new Set(["c1"]) },
      other.req,
      other.res
    );

    await handleCameraNotification(
      JSON.stringify({
        type: "camera:status",
        cameraId: "c1",
        sitterId: "sitter",
        status: "online",
        isEnabled: true,
        lastSeenAt: "2026-10-30T05:00:00+00:00",
      }),
      {
        listRecipients: async () => [
          { owner_id: "owner", booking_id: "b1", camera_id: "c1" },
        ],
      }
    );

    assert.equal(
      owner.res.chunks.filter((row) => row.includes("camera:status")).length,
      1
    );
    assert.equal(
      other.res.chunks.filter((row) => row.includes("camera:status")).length,
      0
    );
    assert.match(owner.res.chunks.at(-1), /\.000Z/);
  });

  it("ends sessions when the access window expires", () => {
    const owner = mockReqRes();
    subscribeCameraEvents(
      { userId: "owner", bookingId: "b1", cameraIds: new Set(["c1"]) },
      owner.req,
      owner.res
    );
    openCameraSession({
      sessionId: "s1",
      cameraId: "c1",
      bookingId: "b1",
      viewerId: "owner",
      publisherId: "sitter",
      validTo: new Date("2026-10-30T04:00:00.000Z"),
    });
    expireCameraSessions(new Date("2026-10-30T05:00:00.000Z"));
    assert.match(owner.res.chunks.at(-1), /window_ended/);
  });

  it("does not leak Ploy's camera:status onto Nok's sitter stream", async () => {
    const ploy = mockReqRes();
    const nok = mockReqRes();
    const ployOwner = mockReqRes();
    subscribeCameraEvents({ userId: "ploy", sitterId: "ploy" }, ploy.req, ploy.res);
    subscribeCameraEvents({ userId: "nok", sitterId: "nok" }, nok.req, nok.res);
    subscribeCameraEvents(
      { userId: "ploy-owner", bookingId: "b-ploy", cameraIds: new Set(["c-ploy"]) },
      ployOwner.req,
      ployOwner.res
    );

    await handleCameraNotification(
      JSON.stringify({
        type: "camera:status",
        cameraId: "c-ploy",
        sitterId: "ploy",
        status: "online",
        isEnabled: true,
        lastSeenAt: "2026-10-30T05:00:00.000Z",
        name: "Ploy living room",
      }),
      {
        listRecipients: async () => [
          { owner_id: "ploy-owner", booking_id: "b-ploy", camera_id: "c-ploy" },
        ],
      }
    );

    assert.equal(
      ploy.res.chunks.filter((row) => row.includes("camera:status")).length,
      1
    );
    assert.equal(
      ployOwner.res.chunks.filter((row) => row.includes("camera:status")).length,
      1
    );
    assert.equal(
      nok.res.chunks.filter((row) => row.includes("camera:status")).length,
      0
    );

    publishCameraEvent({
      type: "camera:status",
      cameraId: "c-nok",
      sitterId: "nok",
      status: "online",
      isEnabled: true,
    });
    assert.equal(
      nok.res.chunks.filter((row) => row.includes("camera:status")).length,
      1
    );
  });

  it("does not leak another sitter's status when sitterId was omitted on subscribe", () => {
    const nok = mockReqRes();
    subscribeCameraEvents({ userId: "nok" }, nok.req, nok.res);
    publishCameraEvent({
      type: "camera:status",
      cameraId: "c-ploy",
      sitterId: "ploy",
      status: "online",
      isEnabled: true,
    });
    assert.equal(
      nok.res.chunks.filter((row) => row.includes("camera:status")).length,
      0
    );
  });

  it("caps live sessions per owner per camera at 2", () => {
    openCameraSession({
      sessionId: "s1",
      cameraId: "c1",
      bookingId: "b1",
      viewerId: "owner",
      publisherId: "sitter",
    });
    openCameraSession({
      sessionId: "s2",
      cameraId: "c1",
      bookingId: "b1",
      viewerId: "owner",
      publisherId: "sitter",
    });
    assert.throws(
      () =>
        openCameraSession({
          sessionId: "s3",
          cameraId: "c1",
          bookingId: "b1",
          viewerId: "owner",
          publisherId: "sitter",
        }),
      (err) => err.statusCode === 429 && /sessions/.test(err.message)
    );
  });

  it("loads a signal-ref from storage and relays the full body over SSE", async () => {
    const sitter = mockReqRes();
    subscribeCameraEvents({ userId: "sitter", sitterId: "sitter" }, sitter.req, sitter.res);
    const sdp = `v=0\n${"y".repeat(8000)}`;
    const stored = {
      type: "signal",
      kind: "offer",
      sessionId: "s-ref",
      cameraId: "c1",
      bookingId: "b1",
      toUserId: "sitter",
      sitterId: "sitter",
      sdp,
    };
    await handleCameraNotification(
      JSON.stringify({ type: "signal-ref", signalId: "sig-1" }),
      { getSignal: async (id) => (id === "sig-1" ? { id, payload: stored } : null) }
    );
    const chunk = sitter.res.chunks.find((row) => row.includes("s-ref"));
    assert.ok(chunk);
    assert.ok(chunk.includes("y".repeat(64)));
    assert.equal(JSON.stringify(stored).includes("signal-ref"), false);
  });
});
