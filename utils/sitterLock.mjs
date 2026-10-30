/** Transaction-scoped lock that exists even when the sitter has zero bookings. */
export const SITTER_SLOT_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext($1::text))`;

export function lockSitterSlot(query, sitterId) {
  return query(SITTER_SLOT_LOCK_SQL, [sitterId]);
}
