import { pool } from "./db.mjs";

/** Inject `query` so tests can mock the db (same idea as createPayoutService). */
export function createPetTypesRepository({ query } = pool) {
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
