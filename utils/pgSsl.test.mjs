import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sslForDatabaseUrl } from "./pgSsl.mjs";

describe("sslForDatabaseUrl", () => {
  it("is off for localhost", () => {
    assert.equal(
      sslForDatabaseUrl("postgres://postgres:postgres@localhost:5432/pet_sitter"),
      undefined
    );
  });

  it("is off for 127.0.0.1", () => {
    assert.equal(
      sslForDatabaseUrl("postgresql://u:p@127.0.0.1:5432/db"),
      undefined
    );
  });

  it("is off for ::1", () => {
    assert.equal(
      sslForDatabaseUrl("postgres://u:p@[::1]:5432/db"),
      undefined
    );
  });

  it("is off when sslmode=disable even on a remote host", () => {
    assert.equal(
      sslForDatabaseUrl(
        "postgres://u:p@db.example.com:5432/db?sslmode=disable"
      ),
      undefined
    );
  });

  it("is on with rejectUnauthorized false otherwise", () => {
    assert.deepEqual(
      sslForDatabaseUrl(
        "postgresql://postgres.ref:secret@aws-0.pooler.supabase.com:5432/postgres"
      ),
      { rejectUnauthorized: false }
    );
  });

  it("stays on when sslmode is require", () => {
    assert.deepEqual(
      sslForDatabaseUrl(
        "postgres://u:p@db.example.com:5432/db?sslmode=require"
      ),
      { rejectUnauthorized: false }
    );
  });
});
