import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFindSignalQuery,
  createCamerasRepository,
  signalMatchesScope,
} from "./cameras.repository.mjs";

const SIGNAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "a1111111-1111-4111-8111-111111111111";
const SITTER = "a2222222-2222-4222-8222-222222222222";
const OTHER = "a9999999-9999-4999-8999-999999999999";
const CAMERA_ID = "ca000001-0001-4001-8001-000000000001";
const BOOKING_ID = "b0000001-0001-4001-8001-000000000001";

function row(overrides = {}) {
  return {
    id: SIGNAL_ID,
    session_id: "sess-1",
    camera_id: CAMERA_ID,
    booking_id: BOOKING_ID,
    payload: {
      type: "signal",
      kind: "offer",
      sessionId: "sess-1",
      cameraId: CAMERA_ID,
      bookingId: BOOKING_ID,
      toUserId: SITTER,
      sitterId: SITTER,
      sdp: "v=0",
    },
    ...overrides,
  };
}

describe("signalMatchesScope", () => {
  it("rejects an unscoped fetch and a cross-user recipient", () => {
    assert.equal(signalMatchesScope(row(), {}), false);
    assert.equal(signalMatchesScope(row(), { userId: OTHER }), false);
    assert.equal(signalMatchesScope(row(), { userId: SITTER }), true);
  });

  it("scopes camera, session, booking, and sitter", () => {
    assert.equal(
      signalMatchesScope(row(), { userId: SITTER, cameraId: CAMERA_ID, sessionId: "sess-1" }),
      true
    );
    assert.equal(
      signalMatchesScope(row(), {
        userId: SITTER,
        cameraId: "ca000001-0001-4001-8001-000000000099",
      }),
      false
    );
    assert.equal(
      signalMatchesScope(row(), { userId: SITTER, sessionId: "other-sess" }),
      false
    );
    assert.equal(
      signalMatchesScope(row(), { userId: SITTER, sitterId: OTHER }),
      false
    );
    assert.equal(
      signalMatchesScope(row(), {
        userId: SITTER,
        cameraIds: new Set([CAMERA_ID]),
      }),
      true
    );
  });
});

describe("findSignal", () => {
  it("does not query without a recipient userId", async () => {
    let queried = false;
    const repo = createCamerasRepository({
      query: async () => {
        queried = true;
        return { rows: [row()] };
      },
    });
    assert.equal(await repo.findSignal(SIGNAL_ID), null);
    assert.equal(await repo.findSignal(SIGNAL_ID, {}), null);
    assert.equal(queried, false);
  });

  it("SQL matches toUserId so a cross-user fetch returns nothing", async () => {
    const { sql, params } = buildFindSignalQuery(SIGNAL_ID, { userId: SITTER });
    assert.match(sql, /payload->>'toUserId' = \$2/);
    assert.deepEqual(params, [SIGNAL_ID, SITTER]);

    const repo = createCamerasRepository({
      query: async (text, values) => {
        assert.match(text, /payload->>'toUserId'/);
        if (values[1] !== SITTER) return { rows: [] };
        return { rows: [row()] };
      },
    });
    assert.equal(await repo.findSignal(SIGNAL_ID, { userId: OTHER }), null);
    const hit = await repo.findSignal(SIGNAL_ID, { userId: SITTER });
    assert.equal(hit.payload.toUserId, SITTER);
    assert.notEqual(OWNER, SITTER);
  });
});
