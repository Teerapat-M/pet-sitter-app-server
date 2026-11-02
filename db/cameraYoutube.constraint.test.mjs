import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { poolConfig } from "./migrate.mjs";
import { YOUTUBE_VIDEO_ID_RE } from "../utils/youtubeVideoId.mjs";

const { Client } = pg;

function isLocalPostgres(url = process.env.DATABASE_URL) {
  if (!url) return false;
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
  } catch {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}

const useDb = isLocalPostgres();
const migration = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/010_camera_youtube_source.sql"),
  "utf8"
);

function checkExpr(name) {
  const match = migration.match(
    new RegExp(`CONSTRAINT ${name}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`)
  );
  assert.ok(match, `expected ${name} in 010_camera_youtube_source.sql`);
  return match[1].replace(/\s+/g, " ").trim();
}

describe("010 cameras youtube constraints", { skip: !useDb }, () => {
  let client;

  before(async () => {
    client = new Client(poolConfig());
    await client.connect();
    const sourceCheck = checkExpr("cameras_source_check");
    const formatCheck = checkExpr("cameras_youtube_video_id_format_check");
    const youtubeIdCheck = checkExpr("cameras_youtube_source_id_check");
    await client.query(`
      CREATE TEMP TABLE cameras_youtube_check (
        source text NOT NULL DEFAULT 'webrtc',
        youtube_video_id text,
        CONSTRAINT cameras_source_check CHECK (${sourceCheck}),
        CONSTRAINT cameras_youtube_video_id_format_check CHECK (${formatCheck}),
        CONSTRAINT cameras_youtube_source_id_check CHECK (${youtubeIdCheck})
      )
    `);
  });

  after(async () => {
    if (client) await client.end();
  });

  it("defaults to webrtc and accepts a valid youtube id", async () => {
    const { rows } = await client.query(
      `INSERT INTO cameras_youtube_check DEFAULT VALUES RETURNING source, youtube_video_id`
    );
    assert.equal(rows[0].source, "webrtc");
    assert.equal(rows[0].youtube_video_id, null);

    const id = "dQw4w9WgXcQ";
    assert.equal(YOUTUBE_VIDEO_ID_RE.test(id), true);
    await client.query(
      `INSERT INTO cameras_youtube_check (source, youtube_video_id) VALUES ('youtube', $1)`,
      [id]
    );
  });

  it("rejects youtube without an id, bad format, stream keys, and unknown source", async () => {
    const reject = async (sql, params) => {
      await assert.rejects(
        () => client.query(sql, params),
        (err) => err?.code === "23514"
      );
    };
    await reject(`INSERT INTO cameras_youtube_check (source) VALUES ('youtube')`);
    await reject(
      `INSERT INTO cameras_youtube_check (source, youtube_video_id) VALUES ('youtube', 'short')`
    );
    await reject(
      `INSERT INTO cameras_youtube_check (source, youtube_video_id)
       VALUES ('youtube', 'xxxx-xxxx-xxxx-xxxx')`
    );
    await reject(
      `INSERT INTO cameras_youtube_check (source, youtube_video_id)
       VALUES ('youtube', 'dQw4w9WgXcQextra')`
    );
    await reject(`INSERT INTO cameras_youtube_check (source) VALUES ('rtmp')`);
  });
});
