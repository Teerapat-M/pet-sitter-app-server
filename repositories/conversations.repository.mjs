import { pool } from "./db.mjs";

export const LIST_FOR_USER_SQL = `
SELECT
  conversations.id,
  conversations.owner_id,
  conversations.sitter_id,
  conversations.created_at,
  bookings.id AS booking_id,
  bookings.owner_id AS booking_owner_id,
  bookings.sitter_id AS booking_sitter_id,
  other_user.id AS other_user_id,
  other_user.name AS other_name,
  other_user.avatar_url AS other_avatar_url,
  other_user.phone AS other_phone,
  other_user.last_seen_at AS other_last_seen_at,
  last_message.content AS last_message,
  last_message.image_url AS last_image_url,
  last_message.sent_at AS last_sent_at,
  unread.unread_count,
  bookings.status AS booking_status,
  bookings.transaction_no AS booking_transaction_no,
  to_char(bookings.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(bookings.end_date, 'YYYY-MM-DD') AS end_date,
  to_char(bookings.start_time, 'HH24:MI') AS start_time,
  to_char(bookings.end_time, 'HH24:MI') AS end_time,
  services.type AS service_type,
  services.mode AS service_mode,
  booking_pets_agg.pets
FROM public.conversations
JOIN public.users AS other_user
  ON other_user.id = CASE
    WHEN conversations.owner_id = $1 THEN conversations.sitter_id
    ELSE conversations.owner_id
  END
LEFT JOIN public.bookings
  ON bookings.id = conversations.booking_id
 AND bookings.owner_id = conversations.owner_id
 AND bookings.sitter_id = conversations.sitter_id
LEFT JOIN public.services
  ON services.id = bookings.service_id
LEFT JOIN LATERAL (
  SELECT json_agg(
    json_build_object('id', pets.id, 'name', pets.name)
    ORDER BY pets.id
  ) AS pets
  FROM public.booking_pets
  JOIN public.pets ON pets.id = booking_pets.pet_id
  WHERE booking_pets.booking_id = bookings.id
) AS booking_pets_agg ON true
LEFT JOIN LATERAL (
  SELECT content, image_url, sent_at
  FROM public.messages
  WHERE messages.conversation_id = conversations.id
  ORDER BY messages.sent_at DESC
  LIMIT 1
) AS last_message ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS unread_count
  FROM public.messages
  WHERE messages.conversation_id = conversations.id
    AND messages.sender_id <> $1
    AND messages.read_at IS NULL
) AS unread ON true
WHERE conversations.owner_id = $1 OR conversations.sitter_id = $1
ORDER BY COALESCE(last_message.sent_at, conversations.created_at) DESC
`;

/** Default query keeps Pool `this` — do not destructure `{ query } = pool`. */
export function createConversationsRepository({
  query = (...args) => pool.query(...args),
} = {}) {
  return {
    async findById(id) {
      const { rows } = await query(
        `SELECT id, owner_id, sitter_id, booking_id, created_at
         FROM public.conversations
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      return rows[0] ?? null;
    },

    async findByOwnerAndSitter(ownerId, sitterId) {
      const { rows } = await query(
        `SELECT id, owner_id, sitter_id, booking_id, created_at
         FROM public.conversations
         WHERE owner_id = $1 AND sitter_id = $2
         LIMIT 1`,
        [ownerId, sitterId]
      );
      return rows[0] ?? null;
    },

    async findBetweenUsers(userA, userB) {
      const { rows } = await query(
        `SELECT id, owner_id, sitter_id, booking_id, created_at
         FROM public.conversations
         WHERE (owner_id = $1 AND sitter_id = $2)
            OR (owner_id = $2 AND sitter_id = $1)
         LIMIT 1`,
        [userA, userB]
      );
      return rows[0] ?? null;
    },

    async resolveBookingIdForPair({ ownerId, sitterId, bookingId }) {
      if (!bookingId) return null;
      const { rows } = await query(
        `SELECT id
         FROM public.bookings
         WHERE id = $1
           AND owner_id = $2
           AND sitter_id = $3
         LIMIT 1`,
        [bookingId, ownerId, sitterId]
      );
      return rows[0]?.id ?? null;
    },

    async create({ ownerId, sitterId, bookingId = null }) {
      const linkedBookingId = await this.resolveBookingIdForPair({
        ownerId,
        sitterId,
        bookingId,
      });
      try {
        const { rows } = await query(
          `INSERT INTO public.conversations (owner_id, sitter_id, booking_id)
           VALUES ($1, $2, $3)
           RETURNING id, owner_id, sitter_id, booking_id, created_at`,
          [ownerId, sitterId, linkedBookingId]
        );
        return rows[0];
      } catch (error) {
        if (error.code === "23505") {
          return this.findByOwnerAndSitter(ownerId, sitterId);
        }
        throw error;
      }
    },

    async setBookingId(id, bookingId) {
      const conversation = await this.findById(id);
      if (!conversation) return null;
      const linkedBookingId = await this.resolveBookingIdForPair({
        ownerId: conversation.owner_id,
        sitterId: conversation.sitter_id,
        bookingId,
      });
      if (bookingId && !linkedBookingId) {
        return conversation;
      }
      const { rows } = await query(
        `UPDATE public.conversations
         SET booking_id = $2
         WHERE id = $1
         RETURNING id, owner_id, sitter_id, booking_id, created_at`,
        [id, linkedBookingId]
      );
      return rows[0] ?? conversation;
    },

    async listForUser(userId) {
      const { rows } = await query(LIST_FOR_USER_SQL, [userId]);
      return rows;
    },
  };
}

export const conversationsRepository = createConversationsRepository();
