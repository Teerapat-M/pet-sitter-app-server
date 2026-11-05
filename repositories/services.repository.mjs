import { pool } from "./db.mjs";

const OFFERING_SELECT = `id, sitter_id, type, mode, duration_minutes, price_amount, currency, is_active`;

/** Default query keeps Pool `this` — do not destructure `{ query } = pool`. */
export function createServicesRepository({
  query = (...args) => pool.query(...args),
} = {}) {
  return {
    async withTransaction(fn) {
      const client = await pool.connect();
      const tx = (...args) => client.query(...args);
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

    async listBySitterId(sitterId, q = query) {
      const { rows } = await q(
        `SELECT ${OFFERING_SELECT}
         FROM public.services
         WHERE sitter_id = $1
         ORDER BY type, mode, duration_minutes`,
        [sitterId]
      );
      return rows;
    },

    async listActiveBySitterId(sitterId) {
      const { rows } = await query(
        `SELECT ${OFFERING_SELECT}
         FROM public.services
         WHERE sitter_id = $1
           AND is_active = true
         ORDER BY type, mode, duration_minutes`,
        [sitterId]
      );
      return rows;
    },

    async insertOffering(sitterId, offering, q = query) {
      const { rows } = await q(
        `INSERT INTO public.services (
           sitter_id, type, mode, duration_minutes, price_amount, currency, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${OFFERING_SELECT}`,
        [
          sitterId,
          offering.type,
          offering.mode,
          offering.durationMinutes,
          offering.priceAmount,
          offering.currency,
          offering.isActive,
        ]
      );
      return rows[0];
    },

    async updateOffering(id, offering, q = query) {
      const { rows } = await q(
        `UPDATE public.services
         SET
           price_amount = $2,
           currency = $3,
           is_active = $4,
           updated_at = now()
         WHERE id = $1
         RETURNING ${OFFERING_SELECT}`,
        [id, offering.priceAmount, offering.currency, offering.isActive]
      );
      return rows[0];
    },

    async deactivateExcept(sitterId, keepIds, q = query) {
      await q(
        `UPDATE public.services
         SET is_active = false, updated_at = now()
         WHERE sitter_id = $1
           AND NOT (id = ANY($2::uuid[]))`,
        [sitterId, keepIds]
      );
    },

    async sitterHasCctv(sitterId) {
      const { rows } = await query(
        `SELECT EXISTS (
           SELECT 1
           FROM public.cameras
           WHERE sitter_id = $1
             AND is_enabled = true
         ) AS has_cctv`,
        [sitterId]
      );
      return Boolean(rows[0]?.has_cctv);
    },
  };
}

export const servicesRepository = createServicesRepository();
