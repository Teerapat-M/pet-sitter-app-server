import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_STUN_URL,
  iceConfigFromEnv,
  iceServersFromEnv,
} from "./iceConfig.mjs";

describe("iceServersFromEnv", () => {
  it("always includes the Google STUN server", () => {
    const servers = iceServersFromEnv({});
    assert.deepEqual(servers, [{ urls: [DEFAULT_STUN_URL] }]);
    assert.equal(DEFAULT_STUN_URL, "stun:stun.l.google.com:19302");
  });

  it("appends optional TURN urls and credentials from env", () => {
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
