import connectionPool from "../utils/db.mjs";

/** Keep Pool/Client `this` — do not destructure `{ query } = pool`. */
function bindQuery(client) {
  return (...args) => client.query(...args);
}

const WALK_SELECT = `
  walks.id,
  walks.booking_id,
  walks.walker_id,
  walks.pet_ids,
  walks.status,
  walks.started_at,
  walks.ended_at,
  walks.distance_m,
  walks.duration_s,
  walks.route_polyline,
  walks.notes,
  walks.summary,
  walks.created_at,
  walks.updated_at
`;

export const walksRepository = {
  async withTransaction(fn) {
    const client = await connectionPool.connect();
    const query = bindQuery(client);
    try {
      await query("BEGIN");
      const result = await fn(query);
      await query("COMMIT");
      return result;
    } catch (error) {
      await query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async findBookingForWalk(bookingId, query = (...args) => connectionPool.query(...args)) {
    const { rows } = await query(
      `
      SELECT
        bookings.id,
        bookings.owner_id,
        bookings.sitter_id,
        bookings.status,
        bookings.duration_unit,
        services.type AS service_type,
        COALESCE(
          (
            SELECT array_agg(booking_pets.pet_id ORDER BY booking_pets.pet_id)
            FROM booking_pets
            WHERE booking_pets.booking_id = bookings.id
          ),
          '{}'::bigint[]
        ) AS pet_ids
      FROM bookings
      LEFT JOIN services ON services.id = bookings.service_id
      WHERE bookings.id = $1
      LIMIT 1
      FOR UPDATE OF bookings
      `,
      [bookingId]
    );
    return rows[0] ?? null;
  },

  async findBookingForWalkRead(bookingId) {
    const { rows } = await connectionPool.query(
      `
      SELECT
        bookings.id,
        bookings.owner_id,
        bookings.sitter_id,
        bookings.status,
        bookings.duration_unit,
        services.type AS service_type
      FROM bookings
      LEFT JOIN services ON services.id = bookings.service_id
      WHERE bookings.id = $1
      LIMIT 1
      `,
      [bookingId]
    );
    return rows[0] ?? null;
  },

  async findByBookingId(bookingId, query = (...args) => connectionPool.query(...args)) {
    const { rows } = await query(
      `SELECT ${WALK_SELECT} FROM walks WHERE booking_id = $1 LIMIT 1`,
      [bookingId]
    );
    return rows[0] ?? null;
  },

  async lockByBookingId(bookingId, query) {
    const { rows } = await query(
      `SELECT ${WALK_SELECT} FROM walks WHERE booking_id = $1 LIMIT 1 FOR UPDATE`,
      [bookingId]
    );
    return rows[0] ?? null;
  },

  async insertLive({ bookingId, walkerId, petIds, startedAt }, query) {
    const { rows } = await query(
      `
      INSERT INTO walks (
        booking_id, walker_id, pet_ids, status, started_at, distance_m, duration_s
      )
      VALUES ($1, $2, $3::bigint[], 'live', $4::timestamptz, 0, 0)
      RETURNING ${WALK_SELECT}
      `,
      [bookingId, walkerId, petIds, startedAt]
    );
    return rows[0];
  },

  async markLive(walkId, startedAt, query) {
    const { rows } = await query(
      `
      UPDATE walks
      SET status = 'live',
          started_at = COALESCE(started_at, $2::timestamptz),
          updated_at = NOW()
      WHERE id = $1
      RETURNING ${WALK_SELECT}
      `,
      [walkId, startedAt]
    );
    return rows[0];
  },

  async lastPoint(walkId, query = (...args) => connectionPool.query(...args)) {
    const { rows } = await query(
      `
      SELECT id, lat, lng, accuracy, recorded_at
      FROM walk_points
      WHERE walk_id = $1
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1
      `,
      [walkId]
    );
    return rows[0] ?? null;
  },

  async firstPoint(walkId, query = (...args) => connectionPool.query(...args)) {
    const { rows } = await query(
      `
      SELECT id, lat, lng, accuracy, recorded_at
      FROM walk_points
      WHERE walk_id = $1
      ORDER BY recorded_at ASC, id ASC
      LIMIT 1
      `,
      [walkId]
    );
    return rows[0] ?? null;
  },

  async insertPoints(walkId, points, query) {
    const inserted = [];
    for (const point of points) {
      const { rows } = await query(
        `
        INSERT INTO walk_points (walk_id, lat, lng, accuracy, recorded_at)
        VALUES ($1, $2, $3, $4, $5::timestamptz)
        RETURNING id, lat, lng, accuracy, recorded_at
        `,
        [walkId, point.lat, point.lng, point.accuracy, point.recordedAt]
      );
      inserted.push(rows[0]);
    }
    return inserted;
  },

  async addDistance(walkId, deltaM, query) {
    const { rows } = await query(
      `
      UPDATE walks
      SET distance_m = distance_m + $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING ${WALK_SELECT}
      `,
      [walkId, deltaM]
    );
    return rows[0];
  },

  async listPoints(walkId, { afterId = null, limit = 2000 } = {}) {
    const { rows } = await connectionPool.query(
      `
      SELECT id, lat, lng, accuracy, recorded_at
      FROM walk_points
      WHERE walk_id = $1
        AND ($2::bigint IS NULL OR id > $2)
      ORDER BY recorded_at ASC, id ASC
      LIMIT $3
      `,
      [walkId, afterId, limit]
    );
    return rows;
  },

  async listAllPoints(walkId, query = (...args) => connectionPool.query(...args)) {
    const { rows } = await query(
      `
      SELECT id, lat, lng, accuracy, recorded_at
      FROM walk_points
      WHERE walk_id = $1
      ORDER BY recorded_at ASC, id ASC
      `,
      [walkId]
    );
    return rows;
  },

  async endWalk(
    { walkId, endedAt, distanceM, durationS, polyline, summary },
    query
  ) {
    const { rows } = await query(
      `
      UPDATE walks
      SET status = 'ended',
          ended_at = $2::timestamptz,
          distance_m = $3,
          duration_s = $4,
          route_polyline = $5,
          summary = $6,
          updated_at = NOW()
      WHERE id = $1
      RETURNING ${WALK_SELECT}
      `,
      [walkId, endedAt, distanceM, durationS, polyline, summary]
    );
    return rows[0];
  },

  async completeBooking(bookingId, query) {
    const { rows } = await query(
      `
      UPDATE bookings
      SET status = 'completed',
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, status
      `,
      [bookingId]
    );
    return rows[0];
  },
};
