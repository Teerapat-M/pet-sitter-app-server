import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createConversationsRepository } from "../repositories/conversations.repository.mjs";
import {
  bookingDates,
  canSeeOtherUserPhone,
  toConversationThread,
} from "./conversationThread.mjs";
import { ONLINE_WINDOW_MS, isOnline } from "../utils/presence.mjs";

function fakePool(rows) {
  return {
    rows,
    lastSql: null,
    lastParams: null,
    async query(sql, params) {
      if (this == null || !Array.isArray(this.rows)) {
        throw new TypeError("Pool.query called without this");
      }
      this.lastSql = sql;
      this.lastParams = params;
      return { rows: this.rows };
    },
  };
}

const baseRow = {
  id: 1,
  owner_id: "owner-1",
  sitter_id: "sitter-1",
  created_at: "2026-10-27T02:00:00.000Z",
  booking_id: "b0000001-0001-4001-8001-000000000001",
  other_user_id: "sitter-1",
  other_name: "Ploy S.",
  other_avatar_url: null,
  other_phone: "0891111111",
  other_last_seen_at: null,
  last_message: "Walk is live",
  last_image_url: null,
  last_sent_at: "2026-10-30T02:12:00.000Z",
  unread_count: 0,
  booking_status: "in_service",
  booking_transaction_no: "PS-2481",
  start_date: "2026-10-28",
  end_date: "2026-11-15",
  start_time: "12:00",
  end_time: "12:00",
  service_type: "boarding",
  service_mode: null,
  pets: [{ id: 1, name: "Bobo" }, { id: 2, name: "Mochi" }],
};

describe("canSeeOtherUserPhone", () => {
  it("shows phone for confirmed and in-service bookings", () => {
    assert.equal(canSeeOtherUserPhone("waiting_service"), true);
    assert.equal(canSeeOtherUserPhone("in_service"), true);
  });

  it("hides phone when there is no active/confirmed booking", () => {
    assert.equal(canSeeOtherUserPhone("waiting_confirm"), false);
    assert.equal(canSeeOtherUserPhone("success"), false);
    assert.equal(canSeeOtherUserPhone("cancelled"), false);
    assert.equal(canSeeOtherUserPhone(null), false);
  });
});

describe("bookingDates", () => {
  it("uses date + times for a same-day booking", () => {
    assert.deepEqual(
      bookingDates({
        startDate: "2026-10-30",
        endDate: "2026-10-30",
        startTime: "09:00",
        endTime: "10:00",
      }),
      { date: "2026-10-30", startTime: "09:00", endTime: "10:00" }
    );
  });

  it("uses start/end for a multi-day booking", () => {
    assert.deepEqual(
      bookingDates({
        startDate: "2026-10-28",
        endDate: "2026-11-15",
        startTime: "12:00",
        endTime: "12:00",
      }),
      {
        start: "2026-10-28",
        end: "2026-11-15",
        startTime: "12:00",
        endTime: "12:00",
      }
    );
  });
});

describe("toConversationThread", () => {
  it("includes booking summary when a booking is linked", () => {
    const thread = toConversationThread(baseRow);
    assert.equal(thread.bookingId, baseRow.booking_id);
    assert.deepEqual(thread.booking, {
      id: baseRow.booking_id,
      service_name: "Boarding",
      dates: {
        start: "2026-10-28",
        end: "2026-11-15",
        startTime: "12:00",
        endTime: "12:00",
      },
      pets: [{ id: 1, name: "Bobo" }, { id: 2, name: "Mochi" }],
      status: "in_service",
      transactionNo: "PS-2481",
    });
    assert.equal(thread.otherUser.phone, "0891111111");
  });

  it("returns null booking fields when no booking is linked", () => {
    const thread = toConversationThread({
      ...baseRow,
      booking_id: null,
      booking_status: null,
      booking_transaction_no: null,
      start_date: null,
      end_date: null,
      start_time: null,
      end_time: null,
      service_type: null,
      pets: null,
    });
    assert.equal(thread.bookingId, null);
    assert.equal(thread.booking, null);
    assert.equal(thread.otherUser.phone, null);
  });

  it("hides phone when the linked booking is not active/confirmed", () => {
    const thread = toConversationThread({
      ...baseRow,
      booking_status: "success",
    });
    assert.equal(thread.booking.status, "success");
    assert.equal(thread.otherUser.phone, null);
  });

  it("sets presence from lastSeenAt and SSE connection", () => {
    const now = Date.parse("2026-10-30T12:00:00.000Z");
    const recent = new Date(now - 30_000).toISOString();
    const stale = new Date(now - ONLINE_WINDOW_MS - 1).toISOString();

    assert.equal(
      toConversationThread(
        { ...baseRow, other_last_seen_at: recent },
        { now }
      ).otherUser.isOnline,
      true
    );
    assert.equal(
      toConversationThread(
        { ...baseRow, other_last_seen_at: stale },
        { now }
      ).otherUser.isOnline,
      false
    );
    assert.equal(
      toConversationThread(
        { ...baseRow, other_last_seen_at: stale },
        { sseConnected: true, now }
      ).otherUser.isOnline,
      true
    );
    assert.equal(
      toConversationThread(
        { ...baseRow, other_last_seen_at: recent },
        { now }
      ).otherUser.lastSeenAt,
      recent
    );
  });
});

describe("isOnline", () => {
  it("is true when SSE is connected even without lastSeenAt", () => {
    assert.equal(isOnline({ lastSeenAt: null, sseConnected: true }), true);
  });
});

describe("createConversationsRepository", () => {
  it("fails if query is destructured off a Pool (unbound this)", async () => {
    const db = fakePool([]);
    const { query } = db;
    await assert.rejects(() => query("SELECT 1"), /without this/);
  });

  it("lists threads with a Pool-like query that relies on this", async () => {
    const db = fakePool([baseRow]);
    const repo = createConversationsRepository({
      query: (...args) => db.query(...args),
    });
    const rows = await repo.listForUser("owner-1");
    assert.equal(rows.length, 1);
    assert.match(db.lastSql, /conversations\.booking_id/);
    assert.match(db.lastSql, /other_user\.last_seen_at/);
    assert.match(db.lastSql, /other_user\.phone/);
    assert.deepEqual(db.lastParams, ["owner-1"]);
  });
});
