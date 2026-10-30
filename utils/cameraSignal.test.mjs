import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  MAX_SIGNAL_BYTES,
  MAX_SIGNALS_PER_MINUTE,
  assertCameraSignalRate,
  parseSignalBody,
  resetCameraSignalRate,
} from "./cameraSignal.mjs";

describe("parseSignalBody", () => {
  it("accepts offer, answer, and ice", () => {
    assert.equal(
      parseSignalBody({ type: "offer", sessionId: "s1", sdp: "v=0" }).type,
      "offer"
    );
    assert.equal(
      parseSignalBody({ type: "answer", sessionId: "s1", sdp: "v=0" }).sdp,
      "v=0"
    );
    assert.deepEqual(
      parseSignalBody({
        type: "ice",
        sessionId: "s1",
        candidate: { candidate: "candidate:1", sdpMid: "0" },
      }).candidate,
      { candidate: "candidate:1", sdpMid: "0" }
    );
  });

  it("rejects oversized payloads", () => {
    const sdp = "x".repeat(MAX_SIGNAL_BYTES);
    assert.throws(
      () => parseSignalBody({ type: "offer", sessionId: "s1", sdp }),
      (err) => err.statusCode === 413
    );
  });

  it("rejects unknown types and missing sdp", () => {
    assert.throws(
      () => parseSignalBody({ type: "bye", sessionId: "s1" }),
      (err) => err.statusCode === 400
    );
    assert.throws(
      () => parseSignalBody({ type: "offer", sessionId: "s1" }),
      (err) => err.statusCode === 400
    );
  });
});

describe("assertCameraSignalRate", () => {
  beforeEach(() => resetCameraSignalRate());

  it("allows a burst then 429s", () => {
    const now = 1_000;
    for (let i = 0; i < MAX_SIGNALS_PER_MINUTE; i += 1) {
      assertCameraSignalRate("cam-1:user-1", now);
    }
    assert.throws(
      () => assertCameraSignalRate("cam-1:user-1", now + 1000),
      (err) => err.statusCode === 429
    );
  });
});
