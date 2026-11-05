/** Live Pet Sitter Plus Supabase project. Schema files may mention it; applying DDL/DML is forbidden. */
export const PLUS_SUPABASE_REF = "dvdzzrcdhafhlvjxrabe";

export function assertNotPlusProductionDatabase({
  databaseUrl = process.env.DATABASE_URL,
  supabaseUrl = process.env.SUPABASE_URL,
} = {}) {
  const haystack = `${databaseUrl ?? ""}\n${supabaseUrl ?? ""}`;
  if (!haystack.includes(PLUS_SUPABASE_REF)) return;
  throw new Error(
    "Refusing to run against the live Pet Sitter Plus Supabase project " +
      `(${PLUS_SUPABASE_REF}). Schema/SQL files are fine; applying them to that DB is forbidden.`
  );
}
