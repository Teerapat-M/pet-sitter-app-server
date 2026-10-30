import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createConversationsRepository,
  LIST_FOR_USER_SQL,
} from "../repositories/conversations.repository.mjs";
import {
  bookingDates,
  canSeeOtherUserPhone,
  resolveLinkedBookingId,
  toConversationThread,
} from "./conversationThread.mjs";
import { ONLINE_WINDOW_MS, isOnline } from "../utils/presence.mjs";

function fakePool(rows) {
  return {
    rows,
    lastSql: null,
    lastParams: null,
    calls: [],
    async query(sql, params) {
      if (this == null || !Array.isArray(this.rows)) {
        throw new TypeError("Pool.query called without this");
      }
      this.lastSql = sql;
      this.lastParams = params;
      this.calls.push({ sql, params });
      return { rows: this.rows };
    },
  };
}

function fakePoolHandler(handler) {
  return {
    lastSql: null,
    lastParams: null,
    calls: [],
    async query(sql, params) {
      if (this == null || typeof this.query !== "function") {
        throw new TypeError("Pool.query called without this");
      }
      this.lastSql = sql;
      this.lastParams = params;
      this.calls.push({ sql, params });
      return handler.call(this, sql, params);
    },
  };
}

const baseRow = {
  id: 1,
  owner_id: "owner-1",
  sitter_id: "sitter-1",
  created_at: "2026-10-27T02:00:00.000Z",
  booking_id: "b0000001-0001-4001-8001-000000000001",
  booking_owner_id: "owner-1",
  booking_sitter_id: "sitter-1",
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
      booking_owner_id: null,
      booking_sitter_id: null,
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

  it("yields booking null and phone null when booking_id is not the conversation pair", () => {
    const thread = toConversationThread({
      ...baseRow,
      booking_id: "b-someone-elses-booking",
      booking_owner_id: "other-owner",
      booking_sitter_id: "other-sitter",
      booking_status: "in_service",
      other_phone: "0891111111",
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

describe("resolveLinkedBookingId", () => {
  it("keeps a booking that matches the conversation pair", () => {
    assert.equal(
      resolveLinkedBookingId(
        { id: "b1", owner_id: "owner-1", sitter_id: "sitter-1" },
        "owner-1",
        "sitter-1"
      ),
      "b1"
    );
  });

  it("rejects a booking that belongs to a different pair", () => {
    assert.equal(
      resolveLinkedBookingId(
        { id: "b1", owner_id: "other-owner", sitter_id: "sitter-1" },
        "owner-1",
        "sitter-1"
      ),
      null
    );
    assert.equal(
      resolveLinkedBookingId(
        { id: "b1", owner_id: "owner-1", sitter_id: "other-sitter" },
        "owner-1",
        "sitter-1"
      ),
      null
    );
    assert.equal(resolveLinkedBookingId(null, "owner-1", "sitter-1"), null);
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
    assert.match(db.lastSql, /bookings\.owner_id = conversations\.owner_id/);
    assert.match(db.lastSql, /bookings\.sitter_id = conversations\.sitter_id/);
    assert.match(db.lastSql, /other_user\.last_seen_at/);
    assert.match(db.lastSql, /other_user\.phone/);
    assert.deepEqual(db.lastParams, ["owner-1"]);
  });

  it("joins bookings only when owner_id and sitter_id match the conversation", () => {
    assert.match(LIST_FOR_USER_SQL, /bookings\.owner_id = conversations\.owner_id/);
    assert.match(LIST_FOR_USER_SQL, /bookings\.sitter_id = conversations\.sitter_id/);
  });

  it("ignores booking_id that does not belong to the owner/sitter pair on create", async () => {
    const db = fakePoolHandler(function handler(sql, params) {
      if (/FROM public.bookings/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO public.conversations/.test(sql)) {
        return {
          rows: [
            {
              id: 9,
              owner_id: params[0],
              sitter_id: params[1],
              booking_id: params[2],
              created_at: "2026-10-30T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createConversationsRepository({
      query: (...args) => db.query(...args),
    });
    const row = await repo.create({
      ownerId: "owner-1",
      sitterId: "sitter-1",
      bookingId: "b-someone-elses-booking",
    });
    assert.equal(row.booking_id, null);
    const lookup = db.calls.find((call) => /FROM public.bookings/.test(call.sql));
    assert.match(lookup.sql, /owner_id = \$2/);
    assert.match(lookup.sql, /sitter_id = \$3/);
    assert.deepEqual(lookup.params, [
      "b-someone-elses-booking",
      "owner-1",
      "sitter-1",
    ]);
    const insert = db.calls.find((call) =>
      /INSERT INTO public.conversations/.test(call.sql)
    );
    assert.equal(insert.params[2], null);
  });

  it("links booking_id on create when the pair matches", async () => {
    const bookingId = "b0000001-0001-4001-8001-000000000001";
    const db = fakePoolHandler(function handler(sql, params) {
      if (/FROM public.bookings/.test(sql)) {
        return { rows: [{ id: bookingId }] };
      }
      if (/INSERT INTO public.conversations/.test(sql)) {
        return {
          rows: [
            {
              id: 9,
              owner_id: params[0],
              sitter_id: params[1],
              booking_id: params[2],
              created_at: "2026-10-30T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = createConversationsRepository({
      query: (...args) => db.query(...args),
    });
    const row = await repo.create({
      ownerId: "owner-1",
      sitterId: "sitter-1",
      bookingId,
    });
    assert.equal(row.booking_id, bookingId);
  });

  it("does not set a mismatched booking_id on an existing conversation", async () => {
    const existing = {
      id: 1,
      owner_id: "owner-1",
      sitter_id: "sitter-1",
      booking_id: null,
      created_at: "2026-10-30T00:00:00.000Z",
    };
    const db = fakePoolHandler(function handler(sql) {
      if (/FROM public.conversations/.test(sql)) {
        return { rows: [existing] };
      }
      if (/FROM public.bookings/.test(sql)) {
        return { rows: [] };
      }
      if (/UPDATE public.conversations/.test(sql)) {
        throw new Error("should not update mismatched booking_id");
      }
      return { rows: [] };
    });
    const repo = createConversationsRepository({
      query: (...args) => db.query(...args),
    });
    const row = await repo.setBookingId(1, "b-someone-elses-booking");
    assert.equal(row.booking_id, null);
    assert.equal(
      db.calls.some((call) => /UPDATE public.conversations/.test(call.sql)),
      false
    );
  });
});
