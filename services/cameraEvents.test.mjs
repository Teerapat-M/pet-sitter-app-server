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
});
