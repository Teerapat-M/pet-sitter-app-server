import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

describe("docs/phase5-api.md ICE contract", () => {
  const md = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "phase5-api.md"),
    "utf8"
  );

  it("documents gated ICE, HMAC TTL, 413 bytes, session caps, disabled 403", () => {
    assert.match(md, /is \*\*not\*\* unscoped/);
    assert.match(md, /cameraId or bookingId is required/);
    assert.match(md, /TTL 300s/);
    assert.match(md, /username = <unixExpiry>:<userId>/);
    assert.match(md, /oversized → \*\*`413`\*\*/);
    assert.match(md, /2 per owner per camera/);
    assert.match(md, /8 total viewers per camera/);
    assert.match(md, /This camera is disabled/);
    assert.match(md, /\*\*403\*\* \(no TURN\)/);
  });
});
