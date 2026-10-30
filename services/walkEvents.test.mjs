import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it, beforeEach } from "node:test";
import {
  publishWalkEvent,
  resetWalkClients,
  subscribeWalkEvents,
  walkStreamCount,
} from "./walkEvents.mjs";

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

describe("walk SSE", () => {
  beforeEach(() => resetWalkClients());

  it("sends the snapshot then live point events to subscribers of that booking", () => {
    const { req, res } = mockReqRes();
    const cleanup = subscribeWalkEvents("b1", req, res, {
      type: "live",
      bookingId: "b1",
      walk: { id: "w1" },
      points: [],
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["Content-Type"], /text\/event-stream/);
    assert.equal(walkStreamCount("b1"), 1);
    assert.match(res.chunks[0], /"type":"live"/);

    const sent = publishWalkEvent({
      type: "point",
      bookingId: "b1",
      point: { lat: 13.73, lng: 100.58 },
    });
    assert.equal(sent, 1);
    assert.match(res.chunks.at(-1), /"type":"point"/);

    publishWalkEvent({
      type: "point",
      bookingId: "other",
      point: { lat: 0, lng: 0 },
    });
    assert.equal(res.chunks.filter((row) => row.includes('"type":"point"')).length, 1);

    publishWalkEvent({
      type: "point",
      bookingId: "b1",
      startedAt: "2026-10-30T02:05:00+00:00",
      point: {
        lat: 13.73,
        lng: 100.58,
        recordedAt: "2026-10-30T02:09:08+00:00",
      },
    });
    const last = res.chunks.at(-1);
    assert.match(last, /"recordedAt":"2026-10-30T02:09:08.000Z"/);
    assert.match(last, /"startedAt":"2026-10-30T02:05:00.000Z"/);
    assert.doesNotMatch(last, /\+00:00/);

    cleanup();
    req.emit("close");
    assert.equal(walkStreamCount("b1"), 0);
  });
});
