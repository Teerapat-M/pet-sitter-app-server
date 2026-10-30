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

  it("turns SSL on for localhost when sslmode is require", () => {
    assert.deepEqual(
      sslForDatabaseUrl(
        "postgres://u:p@localhost:5432/db?sslmode=require"
      ),
      { rejectUnauthorized: false }
    );
  });

  it("turns SSL on for localhost when sslmode is verify-ca", () => {
    assert.deepEqual(
      sslForDatabaseUrl(
        "postgres://u:p@localhost:5432/db?sslmode=verify-ca"
      ),
      { rejectUnauthorized: true }
    );
  });

  it("turns SSL on for 127.0.0.1 when sslmode is verify-full", () => {
    assert.deepEqual(
      sslForDatabaseUrl(
        "postgres://u:p@127.0.0.1:5432/db?sslmode=verify-full"
      ),
      { rejectUnauthorized: true }
    );
  });

  it("is off for a unix-socket host query param", () => {
    assert.equal(
      sslForDatabaseUrl("postgres:///db?host=/var/run/postgresql"),
      undefined
    );
  });

  it("is off when host starts with / (percent-encoded socket path)", () => {
    assert.equal(
      sslForDatabaseUrl("postgres://u:p@%2Fvar%2Frun%2Fpostgresql/db"),
      undefined
    );
  });

  it("is off for userinfo plus host=/socket (invalid WHATWG URL)", () => {
    assert.equal(
      sslForDatabaseUrl(
        "postgres://u:p@/db?host=/cloudsql/proj:region:inst"
      ),
      undefined
    );
  });
});
