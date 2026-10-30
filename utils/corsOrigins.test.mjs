import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOCAL_DEV_ORIGINS,
  corsAllowList,
  parseFrontendOrigins,
} from "./corsOrigins.mjs";

describe("parseFrontendOrigins", () => {
  it("splits a comma-separated FRONTEND_URL and strips trailing slashes", () => {
    assert.deepEqual(
      parseFrontendOrigins(
        " https://petsitter.example/ , http://localhost:3000/ "
      ),
      ["https://petsitter.example", "http://localhost:3000"]
    );
  });

  it("returns an empty list when unset", () => {
    assert.deepEqual(parseFrontendOrigins(""), []);
    assert.deepEqual(parseFrontendOrigins(undefined), []);
  });
});

describe("corsAllowList", () => {
  it("keeps localhost defaults when FRONTEND_URL is empty", () => {
    assert.deepEqual(corsAllowList(""), LOCAL_DEV_ORIGINS);
  });

  it("appends FRONTEND_URL origins without duplicating localhost", () => {
    assert.deepEqual(
      corsAllowList(
        "http://localhost:3000,https://pet-sitter-app-client.vercel.app"
      ),
      [
        ...LOCAL_DEV_ORIGINS,
        "https://pet-sitter-app-client.vercel.app",
      ]
    );
  });

  it("does not include a hardcoded Vercel domain", () => {
    assert.equal(
      corsAllowList("").includes(
        "https://pet-sitter-app-client-khaki.vercel.app"
      ),
      false
    );
  });
});
