import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_STUN_URL,
  DEFAULT_TURN_TTL_SECONDS,
  assertProductionTurnConfig,
  cloudflareTurnCredentialsUrl,
  iceConfigFromEnv,
  iceServersFromEnv,
  mintCloudflareIceServers,
  sanitizeCloudflareIceServers,
  stunOnlyIceServers,
  turnRestCredentials,
} from "./iceConfig.mjs";

const USER = "a1111111-1111-4111-8111-111111111111";
const SECRET = "test-turn-secret";
const NOW = Date.parse("2026-10-30T05:00:00.000Z");

describe("turnRestCredentials", () => {
  it("issues expiry:userId and base64 HMAC-SHA1", () => {
    const creds = turnRestCredentials(USER, SECRET, { now: NOW, ttlSeconds: 300 });
    const expiry = Math.floor(NOW / 1000) + 300;
    const username = `${expiry}:${USER}`;
    assert.equal(creds.username, username);
    assert.equal(
      creds.credential,
      createHmac("sha1", SECRET).update(username).digest("base64")
    );
    assert.equal(creds.ttlSeconds, DEFAULT_TURN_TTL_SECONDS);
  });
});

describe("iceServersFromEnv", () => {
  it("always includes the Google STUN server", () => {
    const servers = iceServersFromEnv({});
    assert.deepEqual(servers, [{ urls: [DEFAULT_STUN_URL] }]);
    assert.equal(DEFAULT_STUN_URL, "stun:stun.l.google.com:19302");
  });

  it("prefers short-lived HMAC creds when TURN_SECRET is set", () => {
    const servers = iceServersFromEnv(
      {
        TURN_URLS: "turn:turn.example.com:3478",
        TURN_SECRET: SECRET,
        TURN_USERNAME: "static-user",
        TURN_CREDENTIAL: "static-pass",
      },
      { userId: USER, now: NOW }
    );
    const expiry = Math.floor(NOW / 1000) + 300;
    assert.equal(servers[1].username, `${expiry}:${USER}`);
    assert.notEqual(servers[1].username, "static-user");
    assert.notEqual(servers[1].credential, "static-pass");
  });

  it("does not attach HMAC without a userId even when TURN_SECRET is set", () => {
    const servers = iceServersFromEnv(
      {
        TURN_URLS: "turn:turn.example.com:3478",
        TURN_SECRET: SECRET,
        TURN_USERNAME: "static-user",
        TURN_CREDENTIAL: "static-pass",
      },
      { now: NOW }
    );
    assert.equal(servers[1].username, undefined);
    assert.equal(servers[1].credential, undefined);
  });

  it("falls back to static TURN user/pass only when TURN_SECRET is unset", () => {
    const servers = iceServersFromEnv({
      TURN_URLS: "turn:turn.example.com:3478, turns:turn.example.com:5349",
      TURN_USERNAME: "user",
      TURN_CREDENTIAL: "placeholder",
    });
    assert.equal(servers[0].urls[0], DEFAULT_STUN_URL);
    assert.deepEqual(servers[1], {
      urls: ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
      username: "user",
      credential: "placeholder",
    });
  });

  it("omits TURN when TURN_URLS is blank", () => {
    const servers = iceServersFromEnv({
      TURN_URLS: "  ",
      TURN_USERNAME: "user",
      TURN_CREDENTIAL: "secret",
      TURN_SECRET: SECRET,
    });
    assert.equal(servers.length, 1);
  });
});

describe("iceConfigFromEnv", () => {
  it("wraps servers for RTCPeerConnection", async () => {
    const config = await iceConfigFromEnv({});
    assert.deepEqual(config.iceServers[0].urls, [DEFAULT_STUN_URL]);
  });
});

const CF_TOKEN = "cf-api-token-secret-do-not-leak";
const CF_KEY = "turn-key-id";
const CF_ICE = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: [
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turn:turn.cloudflare.com:53?transport=udp",
    ],
    username: "cf-user",
    credential: "cf-pass",
  },
];

function cfEnv(extra = {}) {
  return {
    TURN_PROVIDER: "cloudflare",
    CLOUDFLARE_TURN_KEY_ID: CF_KEY,
    CLOUDFLARE_TURN_API_TOKEN: CF_TOKEN,
    ...extra,
  };
}

function okFetch(iceServers = CF_ICE) {
  return async (url, init) => {
    okFetch.calls.push({ url, init });
    return {
      ok: true,
      status: 201,
      async json() {
        return { iceServers };
      },
    };
  };
}
okFetch.calls = [];

describe("assertProductionTurnConfig", () => {
  it("fails fast in production when Cloudflare vars are missing", () => {
    assert.throws(
      () =>
        assertProductionTurnConfig({
          NODE_ENV: "production",
          TURN_PROVIDER: "cloudflare",
        }),
      /CLOUDFLARE_TURN_KEY_ID/
    );
    assert.throws(
      () =>
        assertProductionTurnConfig({
          NODE_ENV: "production",
          TURN_PROVIDER: "cloudflare",
          CLOUDFLARE_TURN_KEY_ID: CF_KEY,
        }),
      /CLOUDFLARE_TURN_API_TOKEN/
    );
    assert.doesNotThrow(() =>
      assertProductionTurnConfig({
        NODE_ENV: "production",
        TURN_PROVIDER: "cloudflare",
        CLOUDFLARE_TURN_KEY_ID: CF_KEY,
        CLOUDFLARE_TURN_API_TOKEN: CF_TOKEN,
      })
    );
    assert.doesNotThrow(() =>
      assertProductionTurnConfig({
        NODE_ENV: "test",
        TURN_PROVIDER: "cloudflare",
      })
    );
    assert.doesNotThrow(() =>
      assertProductionTurnConfig({ NODE_ENV: "production" })
    );
  });

  it("is called from app.mjs at boot", () => {
    const app = fs.readFileSync(
      fileURLToPath(new URL("../app.mjs", import.meta.url)),
      "utf8"
    );
    assert.match(app, /assertProductionTurnConfig/);
  });
});

describe("sanitizeCloudflareIceServers", () => {
  it("drops browser-blocked port 53 URLs", () => {
    const servers = sanitizeCloudflareIceServers(CF_ICE);
    assert.deepEqual(servers[1].urls, [
      "turn:turn.cloudflare.com:3478?transport=udp",
    ]);
  });
});

describe("mintCloudflareIceServers", () => {
  it("POSTs ttl 300 with Bearer token and returns minted ICE", async () => {
    okFetch.calls = [];
    const logs = [];
    const servers = await mintCloudflareIceServers(cfEnv(), {
      fetchImpl: okFetch(),
      log: (msg) => logs.push(msg),
    });
    assert.equal(okFetch.calls.length, 1);
    const call = okFetch.calls[0];
    assert.equal(call.url, cloudflareTurnCredentialsUrl(CF_KEY));
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, `Bearer ${CF_TOKEN}`);
    assert.equal(JSON.parse(call.init.body).ttl, DEFAULT_TURN_TTL_SECONDS);
    assert.equal(servers[0].urls[0], DEFAULT_STUN_URL);
    assert.equal(servers.at(-1).username, "cf-user");
    assert.equal(servers.at(-1).credential, "cf-pass");
    assert.equal(logs.length, 0);
    assert.ok(!JSON.stringify(servers).includes(CF_TOKEN));
  });

  it("falls back to STUN-only on fetch failure and redacts secrets in logs", async () => {
    const logs = [];
    const servers = await mintCloudflareIceServers(cfEnv(), {
      fetchImpl: async () => {
        throw new Error(`upstream said ${CF_TOKEN}`);
      },
      log: (msg) => logs.push(msg),
    });
    assert.deepEqual(servers, stunOnlyIceServers());
    assert.equal(logs.length, 1);
    assert.match(logs[0], /Cloudflare TURN mint failed/);
    assert.equal(logs[0].includes(CF_TOKEN), false);
    assert.match(logs[0], /\[redacted\]/);
  });

  it("falls back to STUN-only on HTTP error without logging the token", async () => {
    const logs = [];
    const servers = await mintCloudflareIceServers(cfEnv(), {
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
      log: (msg) => logs.push(msg),
    });
    assert.deepEqual(servers, stunOnlyIceServers());
    assert.match(logs[0], /HTTP 401/);
    assert.equal(logs.join("").includes(CF_TOKEN), false);
  });

  it("times out mint and falls back to STUN-only", async () => {
    const logs = [];
    const servers = await mintCloudflareIceServers(cfEnv(), {
      timeoutMs: 20,
      fetchImpl: () => new Promise(() => {}),
      log: (msg) => logs.push(msg),
    });
    assert.deepEqual(servers, stunOnlyIceServers());
    assert.match(logs[0], /timeout/);
    assert.equal(logs.join("").includes(CF_TOKEN), false);
  });
});

describe("iceConfigFromEnv cloudflare", () => {
  it("mints via Cloudflare when TURN_PROVIDER=cloudflare", async () => {
    okFetch.calls = [];
    const config = await iceConfigFromEnv(cfEnv(), { fetchImpl: okFetch() });
    assert.equal(okFetch.calls.length, 1);
    assert.equal(config.iceServers.at(-1).username, "cf-user");
    assert.equal(JSON.stringify(config).includes(CF_TOKEN), false);
  });

  it("keeps HMAC when TURN_PROVIDER is unset even if Cloudflare vars exist", async () => {
    const config = await iceConfigFromEnv(
      {
        TURN_URLS: "turn:turn.example.com:3478",
        TURN_SECRET: SECRET,
        CLOUDFLARE_TURN_KEY_ID: CF_KEY,
        CLOUDFLARE_TURN_API_TOKEN: CF_TOKEN,
      },
      { userId: USER, now: NOW, fetchImpl: async () => assert.fail("fetch") }
    );
    const expiry = Math.floor(NOW / 1000) + 300;
    assert.equal(config.iceServers[1].username, `${expiry}:${USER}`);
  });
});
