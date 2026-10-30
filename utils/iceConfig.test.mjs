import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  DEFAULT_STUN_URL,
  DEFAULT_TURN_TTL_SECONDS,
  iceConfigFromEnv,
  iceServersFromEnv,
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
  it("wraps servers for RTCPeerConnection", () => {
    const config = iceConfigFromEnv({});
    assert.deepEqual(config.iceServers[0].urls, [DEFAULT_STUN_URL]);
  });
});
