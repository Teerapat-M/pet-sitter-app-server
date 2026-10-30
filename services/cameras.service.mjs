import { camerasRepository } from "../repositories/cameras.repository.mjs";
import { httpError } from "../utils/httpError.mjs";
import { utcIso } from "../utils/iso.mjs";
import {
  assertCameraEnabled,
  assertCameraMatchesBookingVenue,
  assertOwnerLiveView,
  assertSitterCamera,
  cameraMatchesBookingVenue,
  grantCoversAt,
  viewerOrSitterRole,
} from "../utils/cameraAccess.mjs";
import {
  assertCameraSignalRate,
  assertNotifyPayloadSize,
  parseSignalBody,
} from "../utils/cameraSignal.mjs";
import { iceConfigFromEnv } from "../utils/iceConfig.mjs";
import {
  CAMERA_CHANNEL,
  endSessionsForCamera,
  expireCameraSessions,
  openCameraSession,
  getCameraSession,
} from "./cameraEvents.mjs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value, field = "id") {
  if (!UUID_RE.test(String(value ?? ""))) {
    throw httpError(400, `Invalid ${field}`);
  }
  return String(value);
}

function requireName(value) {
  const name = String(value ?? "").trim();
  if (name.length < 1 || name.length > 80) {
    throw httpError(400, "name must be 1–80 characters");
  }
  return name;
}

function mapCamera(row) {
  if (!row) return null;
  return {
    id: row.id,
    sitterId: row.sitter_id ?? row.sitterId,
    venueId: row.venue_id ?? row.venueId ?? null,
    name: row.name,
    isEnabled: row.is_enabled ?? row.isEnabled,
    status: row.status,
    lastSeenAt: utcIso(row.last_seen_at ?? row.lastSeenAt),
  };
}

function mapAccess(grants, now) {
  if (!grants?.length) {
    return {
      validFrom: null,
      validTo: null,
      now: utcIso(now),
      canView: false,
    };
  }
  const froms = grants.map((g) => new Date(g.valid_from ?? g.validFrom));
  const tos = grants.map((g) => new Date(g.valid_to ?? g.validTo));
  const validFrom = new Date(Math.min(...froms.map((d) => d.getTime())));
  const validTo = new Date(Math.max(...tos.map((d) => d.getTime())));
  return {
    validFrom: utcIso(validFrom),
    validTo: utcIso(validTo),
    now: utcIso(now),
    canView: grants.some((grant) => grantCoversAt(grant, now)),
  };
}

export function createCamerasService({
  camerasRepo = camerasRepository,
  notify = async (payload) => {
    await camerasRepo.notify(CAMERA_CHANNEL, JSON.stringify(payload));
  },
  now = () => new Date(),
  iceConfig = (userId, env, opts) => iceConfigFromEnv(env, { userId, ...opts }),
} = {}) {
  async function loadSitterCamera(userId, cameraId) {
    const camera = await camerasRepo.findById(cameraId);
    assertSitterCamera(camera, userId);
    return camera;
  }

  function ownerGrantOr403(booking, userId, grant) {
    assertOwnerLiveView(booking, userId, { grant: grant ?? null, now: now() });
    return grant;
  }

  async function enqueueSignal(payload) {
    const row = await camerasRepo.insertSignal({
      sessionId: payload.sessionId,
      cameraId: payload.cameraId,
      bookingId: payload.bookingId,
      payload,
    });
    const ref = { type: "signal-ref", signalId: String(row.id) };
    assertNotifyPayloadSize(ref);
    await notify(ref);
    return row;
  }

  return {
    async iceFor(userId, { cameraId, bookingId } = {}, env = process.env) {
      const camId = cameraId ? requireUuid(cameraId, "cameraId") : null;
      const bookId = bookingId ? requireUuid(bookingId, "bookingId") : null;
      if (!camId && !bookId) {
        throw httpError(400, "cameraId or bookingId is required");
      }

      if (camId) {
        const camera = await camerasRepo.findById(camId);
        if (camera && String(camera.sitter_id) === String(userId)) {
          assertCameraEnabled(camera);
          return iceConfig(userId, env, { now: now() });
        }
      }

      if (bookId) {
        const booking = await camerasRepo.findBookingForCamera(bookId);
        if (!booking) {
          throw httpError(404, "Booking not found");
        }
        if (camId) {
          const grant = await camerasRepo.findGrant(booking.id, camId);
          ownerGrantOr403(booking, userId, grant);
          assertCameraMatchesBookingVenue(grant, booking);
          assertCameraEnabled(grant);
        } else {
          const grants = await camerasRepo.listGrantsForBooking(booking.id);
          const covering = grants.filter(
            (grant) =>
              grantCoversAt(grant, now()) && cameraMatchesBookingVenue(grant, booking)
          );
          ownerGrantOr403(booking, userId, covering[0] ?? null);
          const enabled = covering.find(
            (grant) => grant.is_enabled !== false && grant.isEnabled !== false
          );
          assertCameraEnabled(enabled ?? covering[0]);
        }
        return iceConfig(userId, env, { now: now() });
      }

      throw httpError(404, "Camera not found");
    },

    async listMine(userId) {
      const rows = await camerasRepo.listBySitterId(userId);
      return rows.map(mapCamera);
    },

    async getMine(userId, cameraId) {
      const camera = await loadSitterCamera(userId, requireUuid(cameraId, "cameraId"));
      return mapCamera(camera);
    },

    async create(userId, body) {
      const name = requireName(body?.name);
      const venueId = body?.venueId ?? body?.venue_id ?? null;
      if (venueId != null && venueId !== "") {
        requireUuid(venueId, "venueId");
      }
      const row = await camerasRepo.insert({
        sitterId: userId,
        name,
        venueId: venueId || null,
      });
      return mapCamera(row);
    },

    async update(userId, cameraId, body) {
      const camera = await loadSitterCamera(userId, requireUuid(cameraId, "cameraId"));
      const patch = {};
      if (body?.name != null) patch.name = requireName(body.name);
      if (body?.isEnabled != null || body?.is_enabled != null) {
        const enabled = body.isEnabled ?? body.is_enabled;
        if (typeof enabled !== "boolean") {
          throw httpError(400, "isEnabled must be a boolean");
        }
        patch.isEnabled = enabled;
      }
      if (patch.name == null && patch.isEnabled == null) {
        throw httpError(400, "isEnabled or name is required");
      }
      const updated = await camerasRepo.update(camera.id, patch);
      if (patch.isEnabled === false) {
        endSessionsForCamera(camera.id, "camera_disabled");
      }
      return mapCamera(updated);
    },

    async remove(userId, cameraId) {
      const camera = await loadSitterCamera(userId, requireUuid(cameraId, "cameraId"));
      endSessionsForCamera(camera.id, "camera_removed");
      await camerasRepo.remove(camera.id);
      return { id: camera.id, deleted: true };
    },

    async heartbeat(userId, cameraId) {
      const camera = await loadSitterCamera(userId, requireUuid(cameraId, "cameraId"));
      const at = now();
      const status = camera.is_enabled === false ? camera.status : "online";
      const updated = await camerasRepo.heartbeat(camera.id, {
        lastSeenAt: at,
        status,
      });
      return mapCamera(updated);
    },

    async listForBooking(userId, bookingId) {
      const booking = await camerasRepo.findBookingForCamera(requireUuid(bookingId, "bookingId"));
      if (!booking) {
        throw httpError(404, "Booking not found");
      }
      const role = viewerOrSitterRole(booking, userId);
      const grants = (await camerasRepo.listGrantsForBooking(booking.id)).filter(
        (row) => cameraMatchesBookingVenue(row, booking)
      );
      if (role === "owner") {
        const covering = grants.filter((grant) => grantCoversAt(grant, now()));
        ownerGrantOr403(booking, userId, covering[0] ?? null);
      }
      const access = mapAccess(grants, now());
      const cameras = grants.map((row) => ({
        ...mapCamera(row),
        validFrom: utcIso(row.valid_from),
        validTo: utcIso(row.valid_to),
      }));
      return {
        bookingId: booking.id,
        access,
        cameras,
      };
    },

    async snapshotForSitterStream(userId) {
      const cameras = await this.listMine(userId);
      return {
        type: "snapshot",
        cameras,
      };
    },

    async snapshotForBookingStream(userId, bookingId) {
      const data = await this.listForBooking(userId, bookingId);
      return {
        type: "snapshot",
        bookingId: data.bookingId,
        access: data.access,
        cameras: data.cameras,
      };
    },

    async postPublisherSignal(userId, cameraId, body) {
      const camera = await loadSitterCamera(userId, requireUuid(cameraId, "cameraId"));
      assertCameraEnabled(camera);
      const signal = parseSignalBody(body);
      const at = now();
      assertCameraSignalRate(
        `${camera.id}:${userId}`,
        at instanceof Date ? at.getTime() : Number(at)
      );
      const session = getCameraSession(signal.sessionId);
      if (!session || String(session.cameraId) !== String(camera.id)) {
        throw httpError(404, "Signalling session not found");
      }
      if (String(session.publisherId) !== String(userId)) {
        throw httpError(404, "Signalling session not found");
      }
      expireCameraSessions(at instanceof Date ? at : new Date(at));
      if (!getCameraSession(signal.sessionId)) {
        throw httpError(403, "Live view is outside the camera access window");
      }
      const payload = {
        type: "signal",
        kind: signal.type,
        sessionId: signal.sessionId,
        cameraId: camera.id,
        bookingId: session.bookingId,
        fromUserId: userId,
        toUserId: session.viewerId,
        sitterId: userId,
        fromRole: "publisher",
        sdp: signal.sdp,
        candidate: signal.candidate,
      };
      await enqueueSignal(payload);
      return { ok: true, sessionId: signal.sessionId };
    },

    async postViewerSignal(userId, bookingId, cameraId, body) {
      const booking = await camerasRepo.findBookingForCamera(
        requireUuid(bookingId, "bookingId")
      );
      if (!booking) {
        throw httpError(404, "Booking not found");
      }
      const camId = requireUuid(cameraId, "cameraId");
      const grant = await camerasRepo.findGrant(booking.id, camId);
      ownerGrantOr403(booking, userId, grant);
      assertCameraMatchesBookingVenue(grant, booking);
      assertCameraEnabled(grant);
      const signal = parseSignalBody(body);
      const at = now();
      assertCameraSignalRate(
        `${camId}:${userId}`,
        at instanceof Date ? at.getTime() : Number(at)
      );
      const cameraKey = String(grant.camera_id ?? grant.id);
      let session = getCameraSession(signal.sessionId);
      if (!session) {
        if (signal.type !== "offer") {
          throw httpError(404, "Signalling session not found");
        }
        session = openCameraSession({
          sessionId: signal.sessionId,
          cameraId: cameraKey,
          bookingId: booking.id,
          viewerId: userId,
          publisherId: booking.sitter_id,
          validTo: grant.valid_to,
        });
      } else if (
        String(session.cameraId) !== cameraKey ||
        String(session.viewerId) !== String(userId)
      ) {
        throw httpError(409, "sessionId is already in use");
      }
      const payload = {
        type: "signal",
        kind: signal.type,
        sessionId: signal.sessionId,
        cameraId: cameraKey,
        bookingId: booking.id,
        fromUserId: userId,
        toUserId: booking.sitter_id,
        sitterId: booking.sitter_id,
        fromRole: "viewer",
        sdp: signal.sdp,
        candidate: signal.candidate,
      };
      await enqueueSignal(payload);
      return { ok: true, sessionId: signal.sessionId };
    },
  };
}

export const camerasService = createCamerasService();
