import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

describe("docs/turn.md", () => {
  const md = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "turn.md"),
    "utf8"
  );

  it("lists Render env vars and sign-up steps for Cloudflare and Metered", () => {
    assert.match(md, /TURN_PROVIDER/);
    assert.match(md, /cloudflare/);
    assert.match(md, /CLOUDFLARE_TURN_KEY_ID/);
    assert.match(md, /CLOUDFLARE_TURN_API_TOKEN/);
    assert.match(md, /generate-ice-servers/);
    assert.match(md, /TURN_URLS/);
    assert.match(md, /TURN_SECRET/);
    assert.match(md, /TURN_USERNAME/);
    assert.match(md, /TURN_CREDENTIAL/);
    assert.match(md, /standard\.relay\.metered\.ca/);
    assert.match(md, /openrelayproject/);
    assert.match(md, /dash\.cloudflare\.com/);
    assert.match(md, /metered\.ca/);
    assert.match(md, /No client change/);
    assert.match(md, /Render/);
  });
});
