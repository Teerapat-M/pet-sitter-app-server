import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  closeListenClient,
  createListenClient,
  isTransactionPoolerUrl,
  listenClientConfig,
  listenDatabaseUrl,
} from "./listenDb.mjs";

const POOLER =
  "postgresql://postgres.ref:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
const SESSION =
  "postgresql://postgres.ref:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
const DIRECT =
  "postgresql://postgres.ref:secret@db.example.supabase.co:5432/postgres";

describe("listenDatabaseUrl", () => {
  it("prefers LISTEN_DATABASE_URL when set", () => {
    assert.equal(
      listenDatabaseUrl({
        LISTEN_DATABASE_URL: SESSION,
        DATABASE_URL: POOLER,
      }),
      SESSION
    );
  });

  it("falls back to DATABASE_URL when LISTEN_DATABASE_URL is missing", () => {
    assert.equal(
      listenDatabaseUrl({ DATABASE_URL: POOLER }),
      POOLER
    );
  });

  it("falls back when LISTEN_DATABASE_URL is blank", () => {
    assert.equal(
      listenDatabaseUrl({
        LISTEN_DATABASE_URL: "  ",
        DATABASE_URL: DIRECT,
      }),
      DIRECT
    );
  });

  it("does not use DATABASE_URL when LISTEN_DATABASE_URL is present", () => {
    assert.equal(
      listenDatabaseUrl({
        LISTEN_DATABASE_URL: `${SESSION}?sslmode=require`,
        DATABASE_URL: POOLER,
      }),
      `${SESSION}?sslmode=require`
    );
  });
});

describe("isTransactionPoolerUrl", () => {
  it("detects Supabase transaction pooler port 6543", () => {
    assert.equal(isTransactionPoolerUrl(POOLER), true);
    assert.equal(isTransactionPoolerUrl(SESSION), false);
    assert.equal(isTransactionPoolerUrl(DIRECT), false);
  });
});

describe("listenClientConfig SSL", () => {
  it("applies the same SSL rules as the main pool to the selected URL", () => {
    const listen = listenClientConfig({
      LISTEN_DATABASE_URL: `${SESSION}?sslmode=require`,
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
    });
    assert.equal(listen.connectionString, `${SESSION}?sslmode=require`);
    assert.deepEqual(listen.ssl, { rejectUnauthorized: false });

    const fallback = listenClientConfig({
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/pet_sitter",
    });
    assert.equal(fallback.ssl, undefined);

    const verify = listenClientConfig({
      LISTEN_DATABASE_URL:
        "postgres://u:p@db.example.com:5432/db?sslmode=verify-full",
      DATABASE_URL: POOLER,
    });
    assert.deepEqual(verify.ssl, { rejectUnauthorized: true });
  });

  it("throws when neither URL is set", () => {
    assert.throws(() => listenClientConfig({}), /DATABASE_URL is required/);
  });
});

describe("closeListenClient", () => {
  it("ends a dedicated Client and reconnects via end, not pool.release", async () => {
    const calls = [];
    await closeListenClient({
      removeAllListeners() {
        calls.push("off");
      },
      async end() {
        calls.push("end");
      },
    });
    assert.deepEqual(calls, ["off", "end"]);
  });

  it("releases a Pool checkout if release() exists", async () => {
    const calls = [];
    await closeListenClient({
      removeAllListeners() {
        calls.push("off");
      },
      release() {
        calls.push("release");
      },
      async end() {
        calls.push("end");
      },
    });
    assert.deepEqual(calls, ["off", "release"]);
  });
});

describe("createListenClient", () => {
  it("constructs a client with the listen config", () => {
    const calls = [];
    class FakeClient {
      constructor(config) {
        calls.push(config);
      }
    }
    const client = createListenClient(
      { LISTEN_DATABASE_URL: SESSION, DATABASE_URL: POOLER },
      FakeClient
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].connectionString, SESSION);
    assert.deepEqual(calls[0].ssl, { rejectUnauthorized: false });
    assert.equal(client instanceof FakeClient, true);
  });
});

describe("listener wiring", () => {
  it("chat and walk listeners open a dedicated listen client, not the query pool", () => {
    const chat = fs.readFileSync(
      fileURLToPath(new URL("../services/chatEvents.mjs", import.meta.url)),
      "utf8"
    );
    const walk = fs.readFileSync(
      fileURLToPath(new URL("../services/walkEvents.mjs", import.meta.url)),
      "utf8"
    );
    assert.match(chat, /createListenClient/);
    assert.match(walk, /createListenClient/);
    assert.doesNotMatch(chat, /pool\.connect\(\)/);
    assert.doesNotMatch(walk, /pool\.connect\(\)/);
    assert.match(chat, /scheduleReconnect/);
    assert.match(walk, /scheduleReconnect/);
  });
});
