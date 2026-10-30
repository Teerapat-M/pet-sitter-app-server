import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  MAX_NOTIFY_BYTES,
  MAX_SIGNAL_BYTES,
  MAX_SIGNALS_PER_MINUTE,
  PG_NOTIFY_LIMIT_BYTES,
  assertCameraSignalRate,
  assertNotifyPayloadSize,
  parseSignalBody,
  resetCameraSignalRate,
  utf8ByteLength,
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

  it("rejects payloads over 16KB UTF-8", () => {
    assert.equal(MAX_SIGNAL_BYTES, 16384);
    const sdp = "x".repeat(MAX_SIGNAL_BYTES);
    assert.throws(
      () => parseSignalBody({ type: "offer", sessionId: "s1", sdp }),
      (err) => err.statusCode === 413
    );
  });

  it("accepts a Chromium-sized (~6KB) offer", () => {
    const sdp = "v=0\n" + "x".repeat(6034);
    assert.ok(Buffer.byteLength(sdp, "utf8") > 6000);
    assert.ok(Buffer.byteLength(JSON.stringify({ type: "offer", sessionId: "s1", sdp }), "utf8") < MAX_SIGNAL_BYTES);
    assert.equal(parseSignalBody({ type: "offer", sessionId: "s1", sdp }).type, "offer");
  });

  it("413s a Thai payload that fits char length but exceeds UTF-8 bytes", () => {
    const thai = "ก".repeat(5500);
    assert.equal(thai.length, 5500);
    assert.ok(thai.length < MAX_SIGNAL_BYTES);
    assert.ok(Buffer.byteLength(thai, "utf8") > MAX_SIGNAL_BYTES);
    assert.throws(
      () => parseSignalBody({ type: "offer", sessionId: "s1", sdp: thai }),
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

describe("assertNotifyPayloadSize", () => {
  it("keeps signal-ref NOTIFY payloads under the PG 8000 cap", () => {
    assert.equal(PG_NOTIFY_LIMIT_BYTES, 8000);
    assert.ok(MAX_NOTIFY_BYTES < PG_NOTIFY_LIMIT_BYTES);
    const ref = {
      type: "signal-ref",
      signalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    assert.ok(utf8ByteLength(ref) < MAX_NOTIFY_BYTES);
    assert.equal(assertNotifyPayloadSize(ref), JSON.stringify(ref));
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
