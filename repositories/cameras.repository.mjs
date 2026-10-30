import connectionPool from "../utils/db.mjs";
import { httpError } from "../utils/httpError.mjs";
import { isUuid, requireUuid } from "../utils/uuid.mjs";

/** Keep Pool/Client `this` — do not destructure `{ query } = pool`. */
function bindQuery(client) {
  return (...args) => client.query(...args);
}

const CAMERA_SELECT = `
  cameras.id,
  cameras.sitter_id,
  cameras.venue_id,
  cameras.name,
  cameras.is_enabled,
  cameras.status,
  cameras.last_seen_at,
  cameras.created_at,
  cameras.updated_at
`;

function scopeUserId(scope = {}) {
  const userId = scope.userId ?? scope.toUserId;
  if (userId == null || userId === "") return null;
  return String(userId);
}

function asPayload(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

/** True when a camera_signals row is addressed to this subscriber. */
export function signalMatchesScope(row, scope = {}) {
  if (!row) return false;
  const userId = scopeUserId(scope);
  if (!userId) return false;
  const payload = asPayload(row.payload);
  if (String(payload.toUserId ?? "") !== userId) return false;
  if (scope.sitterId && String(payload.sitterId ?? "") !== String(scope.sitterId)) {
    return false;
  }
  if (
    scope.bookingId &&
    String(row.booking_id ?? payload.bookingId ?? "") !== String(scope.bookingId)
  ) {
    return false;
  }
  if (
    scope.sessionId &&
    String(row.session_id ?? payload.sessionId ?? "") !== String(scope.sessionId)
  ) {
    return false;
  }
  const cameraId = String(row.camera_id ?? payload.cameraId ?? "");
  if (scope.cameraId && cameraId !== String(scope.cameraId)) return false;
  if (scope.cameraIds instanceof Set) {
    if (scope.cameraIds.size === 0 || !scope.cameraIds.has(cameraId)) return false;
  }
  return true;
}

export function buildFindSignalQuery(signalId, scope = {}) {
  const userId = scopeUserId(scope);
  const params = [signalId, userId];
  let sql = `
    SELECT id, session_id, camera_id, booking_id, payload, created_at
    FROM camera_signals
    WHERE id = $1
      AND payload->>'toUserId' = $2
  `;
  if (scope.sitterId) {
    params.push(String(scope.sitterId));
    sql += ` AND payload->>'sitterId' = $${params.length}`;
  }
  if (scope.bookingId) {
    params.push(String(scope.bookingId));
    sql += ` AND booking_id IS NOT DISTINCT FROM $${params.length}`;
  }
  if (scope.sessionId) {
    params.push(String(scope.sessionId));
    sql += ` AND session_id = $${params.length}`;
  }
  if (scope.cameraId) {
    params.push(String(scope.cameraId));
    sql += ` AND camera_id = $${params.length}`;
  }
  if (scope.cameraIds instanceof Set) {
    params.push([...scope.cameraIds].map(String));
    sql += ` AND camera_id = ANY($${params.length}::uuid[])`;
  }
  sql += " LIMIT 1";
  return { sql, params };
}

export function createCamerasRepository({
  query = (...args) => connectionPool.query(...args),
} = {}) {
  return {
    async withTransaction(fn) {
      const client = await connectionPool.connect();
      const tx = bindQuery(client);
      try {
        await tx("BEGIN");
        const result = await fn(tx);
        await tx("COMMIT");
        return result;
      } catch (error) {
        await tx("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async notify(channel, payload, q = query) {
      await q("SELECT pg_notify($1, $2)", [channel, payload]);
    },

    async listBySitterId(sitterId, q = query) {
      const { rows } = await q(
        `SELECT ${CAMERA_SELECT}
         FROM cameras
         WHERE sitter_id = $1
         ORDER BY created_at ASC, name ASC`,
        [sitterId]
      );
      return rows;
    },

    async findById(cameraId, q = query) {
      if (!isUuid(cameraId)) return null;
      const { rows } = await q(
        `SELECT ${CAMERA_SELECT}
         FROM cameras
         WHERE id = $1
         LIMIT 1`,
        [cameraId]
      );
      return rows[0] ?? null;
    },

    async insert({ sitterId, name, venueId }, q = query) {
      const { rows } = await q(
        `INSERT INTO cameras (sitter_id, name, venue_id, is_enabled, status)
         VALUES ($1, $2, $3, true, 'offline')
         RETURNING ${CAMERA_SELECT}`,
        [sitterId, name, venueId ?? null]
      );
      return rows[0];
    },

    async update(cameraId, { name, isEnabled, status, lastSeenAt }, q = query) {
      const { rows } = await q(
        `UPDATE cameras
         SET
           name = COALESCE($2, name),
           is_enabled = COALESCE($3, is_enabled),
           status = COALESCE($4, status),
           last_seen_at = COALESCE($5, last_seen_at),
           updated_at = now()
         WHERE id = $1
         RETURNING ${CAMERA_SELECT}`,
        [cameraId, name ?? null, isEnabled, status ?? null, lastSeenAt ?? null]
      );
      return rows[0] ?? null;
    },

    async remove(cameraId, q = query) {
      const { rows } = await q(
        `DELETE FROM cameras WHERE id = $1 RETURNING ${CAMERA_SELECT}`,
        [cameraId]
      );
      return rows[0] ?? null;
    },

    async heartbeat(cameraId, { lastSeenAt, status }, q = query) {
      const { rows } = await q(
        `UPDATE cameras
         SET
           last_seen_at = $2,
           status = $3,
           updated_at = now()
         WHERE id = $1
         RETURNING ${CAMERA_SELECT}`,
        [cameraId, lastSeenAt, status]
      );
      return rows[0] ?? null;
    },

    async markStaleOffline(staleMs, now = new Date(), q = query) {
      const cutoff = new Date(now.getTime() - staleMs);
      const { rows } = await q(
        `UPDATE cameras
         SET status = 'offline', updated_at = now()
         WHERE status IN ('online', 'reconnecting')
           AND (last_seen_at IS NULL OR last_seen_at < $1)
         RETURNING ${CAMERA_SELECT}`,
        [cutoff]
      );
      return rows;
    },

    async findBookingForCamera(bookingId, q = query) {
      if (!isUuid(bookingId)) return null;
      const { rows } = await q(
        `SELECT
           bookings.id,
           bookings.owner_id,
           bookings.sitter_id,
           bookings.status,
           bookings.duration_unit,
           bookings.venue_id,
           services.type AS service_type,
           ((bookings.start_date + bookings.start_time) AT TIME ZONE 'Asia/Bangkok') AS booking_start,
           ((COALESCE(bookings.end_date, bookings.start_date) + bookings.end_time) AT TIME ZONE 'Asia/Bangkok') AS booking_end
         FROM bookings
         LEFT JOIN services ON services.id = bookings.service_id
         WHERE bookings.id = $1
         LIMIT 1`,
        [bookingId]
      );
      return rows[0] ?? null;
    },

    async listGrantsForBooking(bookingId, q = query) {
      if (!isUuid(bookingId)) return [];
      const { rows } = await q(
        `SELECT
           g.id,
           g.booking_id,
           g.owner_id,
           g.camera_id,
           g.valid_from,
           g.valid_to,
           ${CAMERA_SELECT}
         FROM camera_access_grants g
         INNER JOIN cameras ON cameras.id = g.camera_id
         WHERE g.booking_id = $1
         ORDER BY cameras.created_at ASC, cameras.name ASC`,
        [bookingId]
      );
      return rows;
    },

    async findGrant(bookingId, cameraId, q = query) {
      if (!isUuid(bookingId) || !isUuid(cameraId)) return null;
      const { rows } = await q(
        `SELECT
           g.id,
           g.booking_id,
           g.owner_id,
           g.camera_id,
           g.valid_from,
           g.valid_to,
           ${CAMERA_SELECT}
         FROM camera_access_grants g
         INNER JOIN cameras ON cameras.id = g.camera_id
         WHERE g.booking_id = $1 AND g.camera_id = $2
         LIMIT 1`,
        [bookingId, cameraId]
      );
      return rows[0] ?? null;
    },

    async listActiveGrantRecipients(cameraId, now = new Date(), q = query) {
      const { rows } = await q(
        `SELECT
           g.owner_id,
           g.booking_id,
           g.camera_id,
           g.valid_from,
           g.valid_to
         FROM camera_access_grants g
         INNER JOIN bookings ON bookings.id = g.booking_id
         LEFT JOIN services ON services.id = bookings.service_id
         WHERE g.camera_id = $1
           AND bookings.status = 'in_service'
           AND (
             services.type = 'boarding'
             OR (services.type IS NULL AND bookings.duration_unit IN ('nights', 'Day'))
           )
           AND $2 >= g.valid_from
           AND $2 <= g.valid_to`,
        [cameraId, now]
      );
      return rows;
    },

    async ensureGrantsForBooking(bookingId, q = query) {
      await q("SELECT public.ensure_camera_grants_for_booking($1)", [bookingId]);
    },

    async insertSignal({ sessionId, cameraId, bookingId, payload }, q = query) {
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw httpError(400, "Invalid sessionId");
      }
      requireUuid(cameraId, "cameraId");
      if (bookingId != null && bookingId !== "") {
        requireUuid(bookingId, "bookingId");
      }
      const { rows } = await q(
        `WITH expired AS (
           DELETE FROM camera_signals
           WHERE created_at < now() - interval '5 minutes'
         )
         INSERT INTO camera_signals (session_id, camera_id, booking_id, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, session_id, camera_id, booking_id, payload, created_at`,
        [sessionId, cameraId, bookingId ?? null, JSON.stringify(payload)]
      );
      return rows[0];
    },

    async findSignalById(signalId, q = query) {
      if (!isUuid(signalId)) return null;
      const { rows } = await q(
        `SELECT id, session_id, camera_id, booking_id, payload, created_at
         FROM camera_signals
         WHERE id = $1
         LIMIT 1`,
        [signalId]
      );
      return rows[0] ?? null;
    },

    async findSignal(signalId, scope = {}, q = query) {
      if (typeof scope === "function") {
        q = scope;
        scope = {};
      }
      if (!isUuid(signalId) || !scopeUserId(scope)) {
        return null;
      }
      if (scope.cameraId && !isUuid(scope.cameraId)) return null;
      if (scope.bookingId && !isUuid(scope.bookingId)) return null;
      if (scope.cameraIds instanceof Set) {
        for (const id of scope.cameraIds) {
          if (!isUuid(id)) return null;
        }
      }
      const { sql, params } = buildFindSignalQuery(signalId, scope);
      const { rows } = await q(sql, params);
      return rows[0] ?? null;
    },

    async deleteExpiredSignals(maxAgeMs = 5 * 60 * 1000, now = new Date(), q = query) {
      const cutoff = new Date(now.getTime() - maxAgeMs);
      const result = await q(
        `DELETE FROM camera_signals WHERE created_at < $1`,
        [cutoff]
      );
      return result.rowCount ?? 0;
    },
  };
}

export const camerasRepository = createCamerasRepository();
