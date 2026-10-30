import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import cors from "cors";
import express from "express";
import {
  LOCAL_DEV_ORIGINS,
  corsAllowList,
  corsOptions,
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

describe("cors credentials", () => {
  it("sends Access-Control-Allow-Credentials on preflight and GET from an allowed origin", async () => {
    const origin = "http://localhost:3000";
    const app = express();
    app.use(cors(corsOptions("")));
    app.get("/health", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}/health`;

      const preflight = await fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
        },
      });
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
      assert.equal(
        preflight.headers.get("access-control-allow-credentials"),
        "true"
      );

      const response = await fetch(url, {
        headers: { Origin: origin },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal(
        response.headers.get("access-control-allow-credentials"),
        "true"
      );
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
