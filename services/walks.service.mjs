import { walksRepository } from "../repositories/walks.repository.mjs";
import { httpError } from "../utils/httpError.mjs";
import {
  assertPartyAccess,
  assertWalkerWriteAccess,
} from "../utils/bookingAuth.mjs";
import { utcIso } from "../utils/iso.mjs";
import { encodeLatLngPolyline, sumPathMeters } from "../utils/geo.mjs";
import {
  assertWalkPostRate,
  filterWalkPoints,
  incrementalDistanceM,
  normalizeWalkPointsBody,
} from "../utils/walkPoints.mjs";

function isDogWalking(booking) {
  const type = String(booking?.service_type ?? booking?.serviceType ?? "");
  if (type === "dog_walking") return true;
  return String(booking?.duration_unit ?? "") === "walk";
}

function toIso(value) {
  return utcIso(value);
}

function mapPoint(row) {
  if (!row) return null;
  return {
    id: row.id != null ? Number(row.id) : undefined,
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy: row.accuracy == null ? null : Number(row.accuracy),
    recordedAt: toIso(row.recorded_at ?? row.recordedAt),
  };
}

function mapWalk(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    bookingId: row.booking_id ?? row.bookingId,
    walkerId: row.walker_id ?? row.walkerId,
    petIds: row.pet_ids ?? row.petIds ?? [],
    status: row.status,
    startedAt: toIso(row.started_at ?? row.startedAt),
    endedAt: toIso(row.ended_at ?? row.endedAt),
    distanceM: Number(row.distance_m ?? row.distanceM ?? 0),
    durationS: Number(row.duration_s ?? row.durationS ?? 0),
    polyline: row.route_polyline ?? row.polyline ?? null,
    summary: row.summary ?? null,
    ...extras,
  };
}

function summaryFrom(walk, points) {
  const mapped = (points ?? []).map(mapPoint).filter(Boolean);
  const start = mapped[0] ?? null;
  const end = mapped.length ? mapped[mapped.length - 1] : null;
  const startedAt = walk?.started_at ?? walk?.startedAt ?? start?.recordedAt;
  const endedAt = walk?.ended_at ?? walk?.endedAt ?? end?.recordedAt;
  let durationS = Number(walk?.duration_s ?? walk?.durationS ?? 0);
  if (!durationS && startedAt && endedAt) {
    durationS = Math.max(
      0,
      Math.round((new Date(endedAt) - new Date(startedAt)) / 1000)
    );
  }
  return {
    distanceM: Number(walk?.distance_m ?? walk?.distanceM ?? 0),
    durationS,
    startedAt: toIso(startedAt),
    endedAt: toIso(endedAt),
    start: start ? { lat: start.lat, lng: start.lng } : null,
    end: end ? { lat: end.lat, lng: end.lng } : null,
  };
}

function formatSummaryText(distanceM, durationS) {
  const km = (Number(distanceM) / 1000).toFixed(2);
  const minutes = Math.max(1, Math.round(Number(durationS) / 60));
  return `${km} km in ${minutes} min`;
}

export function createWalksService({
  walksRepo = walksRepository,
  now = () => Date.now(),
} = {}) {
  async function loadPartyBooking(userId, bookingId) {
    const booking = await walksRepo.findBookingForWalkRead(bookingId);
    assertPartyAccess(booking, userId);
    return booking;
  }

  return {
    async startWalk(userId, bookingId) {
      const startedAt = new Date(now());
      const walk = await walksRepo.withTransaction(async (query) => {
        const booking = await walksRepo.findBookingForWalk(bookingId, query);
        assertWalkerWriteAccess(booking, userId);
        if (!isDogWalking(booking)) {
          throw httpError(400, "Walk tracking is for dog walking bookings");
        }
        if (booking.status !== "in_service") {
          throw httpError(
            400,
            "Walk can start only while the booking is in service"
          );
        }

        const existing = await walksRepo.lockByBookingId(bookingId, query);
        if (existing?.status === "live") {
          return existing;
        }
        if (existing?.status === "ended") {
          throw httpError(409, "This walk has already ended");
        }
        if (existing) {
          return walksRepo.markLive(existing.id, startedAt, query);
        }
        return walksRepo.insertLive(
          {
            bookingId,
            walkerId: userId,
            petIds: booking.pet_ids ?? [],
            startedAt,
          },
          query
        );
      });

      return mapWalk(walk);
    },

    async postPoints(userId, bookingId, body) {
      const rawPoints = normalizeWalkPointsBody(body);
      const at = now();

      const result = await walksRepo.withTransaction(async (query) => {
        const booking = await walksRepo.findBookingForWalk(bookingId, query);
        assertWalkerWriteAccess(booking, userId);
        if (!isDogWalking(booking)) {
          throw httpError(400, "Walk tracking is for dog walking bookings");
        }
        if (booking.status !== "in_service") {
          throw httpError(
            400,
            "Points can be posted only while the booking is in service"
          );
        }

        const walk = await walksRepo.lockByBookingId(bookingId, query);
        if (!walk || walk.status !== "live") {
          throw httpError(400, "Start the walk before posting points");
        }

        assertWalkPostRate(walk.id, at);
        const lastPoint = await walksRepo.lastPoint(walk.id, query);
        const { accepted, skipped } = filterWalkPoints(rawPoints, {
          lastPoint,
          startedAt: walk.started_at,
          now: at,
        });
        const inserted = await walksRepo.insertPoints(walk.id, accepted, query);
        const delta = incrementalDistanceM(lastPoint, accepted);
        const updated = await walksRepo.addDistance(walk.id, delta, query);
        return { walk: updated, inserted, skipped };
      });

      return {
        accepted: result.inserted.length,
        skipped: result.skipped.length,
        distanceM: Number(result.walk.distance_m),
        points: result.inserted.map(mapPoint),
      };
    },

    async endWalk(userId, bookingId) {
      const wallClockEnd = new Date(now());
      const ended = await walksRepo.withTransaction(async (query) => {
        const booking = await walksRepo.findBookingForWalk(bookingId, query);
        assertWalkerWriteAccess(booking, userId);
        if (!isDogWalking(booking)) {
          throw httpError(400, "Walk tracking is for dog walking bookings");
        }
        if (booking.status !== "in_service") {
          throw httpError(
            400,
            "Walk can end only while the booking is in service"
          );
        }

        const walk = await walksRepo.lockByBookingId(bookingId, query);
        if (!walk || walk.status !== "live") {
          throw httpError(400, "No live walk to end");
        }

        const points = await walksRepo.listAllPoints(walk.id, query);
        const mapped = points.map((row) => ({
          lat: Number(row.lat),
          lng: Number(row.lng),
          recordedAt: row.recorded_at,
        }));
        const distanceM = mapped.length
          ? sumPathMeters(mapped)
          : Number(walk.distance_m);
        const lastPointAt = mapped.length
          ? new Date(mapped[mapped.length - 1].recordedAt)
          : null;
        const endedAt =
          lastPointAt && !Number.isNaN(lastPointAt.getTime())
            ? lastPointAt
            : wallClockEnd;
        const startedAt = walk.started_at ?? mapped[0]?.recordedAt ?? endedAt;
        const durationS = mapped.length
          ? Math.max(
              0,
              Math.round((endedAt.getTime() - new Date(startedAt).getTime()) / 1000)
            )
          : 0;
        const polyline = encodeLatLngPolyline(mapped);
        const summary = formatSummaryText(distanceM, durationS);
        const updated = await walksRepo.endWalk(
          {
            walkId: walk.id,
            endedAt,
            distanceM,
            durationS,
            polyline,
            summary,
          },
          query
        );
        await walksRepo.completeBooking(bookingId, query);
        return { walk: updated, points };
      });

      return mapWalk(ended.walk, {
        summary: ended.walk.summary,
        ...summaryFrom(ended.walk, ended.points),
      });
    },

    async getWalk(userId, bookingId) {
      const booking = await loadPartyBooking(userId, bookingId);
      if (!isDogWalking(booking)) {
        throw httpError(400, "Walk tracking is for dog walking bookings");
      }
      const walk = await walksRepo.findByBookingId(bookingId);
      if (!walk) {
        return null;
      }
      const [firstPoint, lastPoint] = await Promise.all([
        walksRepo.firstPoint(walk.id),
        walksRepo.lastPoint(walk.id),
      ]);
      const points = [firstPoint, lastPoint].filter(Boolean);
      return mapWalk(walk, {
        lastPoint: mapPoint(lastPoint),
        summary: summaryFrom(walk, points),
      });
    },

    async listPoints(userId, bookingId, { afterId, limit } = {}) {
      const booking = await loadPartyBooking(userId, bookingId);
      if (!isDogWalking(booking)) {
        throw httpError(400, "Walk tracking is for dog walking bookings");
      }
      const walk = await walksRepo.findByBookingId(bookingId);
      if (!walk) {
        throw httpError(404, "Walk not found");
      }
      const parsedLimit = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
      const parsedAfter =
        afterId == null || afterId === "" ? null : Number(afterId);
      const [points, firstPoint, lastPoint] = await Promise.all([
        walksRepo.listPoints(walk.id, {
          afterId: Number.isFinite(parsedAfter) ? parsedAfter : null,
          limit: parsedLimit,
        }),
        walksRepo.firstPoint(walk.id),
        walksRepo.lastPoint(walk.id),
      ]);
      return {
        walk: mapWalk(walk),
        summary: summaryFrom(walk, [firstPoint, lastPoint].filter(Boolean)),
        points: points.map(mapPoint),
      };
    },

    async snapshotForStream(userId, bookingId) {
      const booking = await loadPartyBooking(userId, bookingId);
      if (!isDogWalking(booking)) {
        throw httpError(400, "Walk tracking is for dog walking bookings");
      }
      const walk = await walksRepo.findByBookingId(bookingId);
      if (!walk) {
        return { type: "waiting", bookingId, walk: null, points: [] };
      }
      const points = await walksRepo.listPoints(walk.id, { limit: 50 });
      return {
        type: walk.status === "live" ? "live" : walk.status,
        bookingId,
        walk: mapWalk(walk, { summary: summaryFrom(walk, points) }),
        points: points.map(mapPoint),
      };
    },
  };
}

export const walksService = createWalksService();
