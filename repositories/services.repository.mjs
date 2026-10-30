import { pool } from "./db.mjs";

/** Default query keeps Pool `this` — do not destructure `{ query } = pool`. */
export function createServicesRepository({
  query = (...args) => pool.query(...args),
} = {}) {
  return {
    async listActiveBySitterId(sitterId) {
      const { rows } = await query(
        `SELECT id, sitter_id, type, mode, duration_minutes, price_amount, currency, is_active
         FROM public.services
         WHERE sitter_id = $1
           AND is_active = true
         ORDER BY type, mode, duration_minutes`,
        [sitterId]
      );
      return rows;
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
