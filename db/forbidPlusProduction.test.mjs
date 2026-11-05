import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLUS_SUPABASE_REF,
  assertNotPlusProductionDatabase,
} from "./forbidPlusProduction.mjs";
import { poolConfig } from "./migrate.mjs";

describe("assertNotPlusProductionDatabase", () => {
  it("allows local and placeholder URLs", () => {
    assert.doesNotThrow(() =>
      assertNotPlusProductionDatabase({
        databaseUrl: "postgres://postgres:postgres@localhost:5432/pet_sitter",
        supabaseUrl: "https://example.supabase.co",
      })
    );
  });

  it("blocks the live Plus project ref in DATABASE_URL", () => {
    assert.throws(
      () =>
        assertNotPlusProductionDatabase({
          databaseUrl: `postgresql://postgres.${PLUS_SUPABASE_REF}:x@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
        }),
      (err) => {
        assert.match(err.message, /live Pet Sitter Plus/);
        assert.match(err.message, new RegExp(PLUS_SUPABASE_REF));
        return true;
      }
    );
  });

  it("blocks the live Plus project ref in SUPABASE_URL", () => {
    assert.throws(
      () =>
        assertNotPlusProductionDatabase({
          supabaseUrl: `https://${PLUS_SUPABASE_REF}.supabase.co`,
        }),
      (err) => {
        assert.match(err.message, /live Pet Sitter Plus/);
        return true;
      }
    );
  });
});

describe("poolConfig Plus guard", () => {
  it("refuses migrate/seed/verify against the Plus project", () => {
    assert.throws(
      () =>
        poolConfig(
          `postgresql://postgres.${PLUS_SUPABASE_REF}:x@db.${PLUS_SUPABASE_REF}.supabase.co:5432/postgres`
        ),
      /live Pet Sitter Plus/
    );
  });
});
