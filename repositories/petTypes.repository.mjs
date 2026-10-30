import { pool } from "./db.mjs";

/** Inject `query` so tests can mock the db (same idea as createPayoutService).
 *  Default must keep `this` on the Pool — `{ query } = pool` unbinds query and 500s. */
export function createPetTypesRepository({
  query = (...args) => pool.query(...args),
} = {}) {
  return {
    async findAll() {
      const { rows } = await query(
        `SELECT id, name
         FROM public.pet_types
         ORDER BY id`
      );
      return rows;
    },
  };
}

export const petTypesRepository = createPetTypesRepository();
