import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  YOUTUBE_VIDEO_ID_RE,
  assertWebrtcSignalling,
  cameraSource,
  isYoutubeCamera,
  parseYoutubeVideoId,
  sourceFieldsFromBody,
  youtubeVideoIdForClient,
} from "./youtubeVideoId.mjs";

const ID = "dQw4w9WgXcQ";

describe("YOUTUBE_VIDEO_ID_RE", () => {
  it("matches the SQL 11-char check", () => {
    assert.equal(YOUTUBE_VIDEO_ID_RE.test(ID), true);
    assert.equal(YOUTUBE_VIDEO_ID_RE.test("abcdefghijk"), true);
    assert.equal(YOUTUBE_VIDEO_ID_RE.test("abc_def-gh1"), true);
    assert.equal(YOUTUBE_VIDEO_ID_RE.test("short"), false);
    assert.equal(YOUTUBE_VIDEO_ID_RE.test("dQw4w9WgXcQextra"), false);
    assert.equal(YOUTUBE_VIDEO_ID_RE.test("xxxx-xxxx-xxxx-xxxx"), false);
    assert.equal(YOUTUBE_VIDEO_ID_RE.test(""), false);
  });
});

describe("parseYoutubeVideoId", () => {
  it("accepts watch, youtu.be, live, and a bare 11-char id", () => {
    assert.equal(parseYoutubeVideoId(ID), ID);
    assert.equal(parseYoutubeVideoId(`https://www.youtube.com/watch?v=${ID}`), ID);
    assert.equal(parseYoutubeVideoId(`https://youtube.com/watch?v=${ID}&t=12`), ID);
    assert.equal(parseYoutubeVideoId(`https://m.youtube.com/watch?v=${ID}`), ID);
    assert.equal(parseYoutubeVideoId(`youtube.com/watch?v=${ID}`), ID);
    assert.equal(parseYoutubeVideoId(`https://youtu.be/${ID}`), ID);
    assert.equal(parseYoutubeVideoId(`https://youtu.be/${ID}?si=abc`), ID);
    assert.equal(parseYoutubeVideoId(`youtu.be/${ID}`), ID);
    assert.equal(parseYoutubeVideoId(`https://www.youtube.com/live/${ID}`), ID);
    assert.equal(parseYoutubeVideoId(`https://www.youtube.com/live/${ID}/`), ID);
    assert.equal(parseYoutubeVideoId(`https://youtube.com/live/${ID}?feature=share`), ID);
    assert.equal(parseYoutubeVideoId(`  ${ID}  `), ID);
  });

  it("rejects embed, shorts, stream keys, RTMP, and anything else", () => {
    const reject = (value) =>
      assert.throws(
        () => parseYoutubeVideoId(value),
        (err) => err.statusCode === 400 && err.message === "Invalid YouTube video URL or id"
      );

    reject("https://www.youtube.com/embed/" + ID);
    reject("https://www.youtube.com/shorts/" + ID);
    reject("https://www.youtube.com/watch?v=short");
    reject("https://www.youtube.com/watch?v=" + ID + "extra");
    reject("https://youtu.be/" + ID + "/extra");
    reject("https://music.youtube.com/watch?v=" + ID);
    reject("https://youtube.com/live");
    reject("https://www.youtube.com/live/my-custom-handle");
    reject("xxxx-xxxx-xxxx-xxxx");
    reject("live_1234-xxxx-xxxx-xxxx-xxxx");
    reject("rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx-xxxx");
    reject("https://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx-xxxx");
    reject("https://studio.youtube.com/video/" + ID + "/livestreaming");
    reject("https://vimeo.com/" + ID);
    reject("");
    reject("not a url");
    reject(null);
    reject(12);
  });
});

describe("sourceFieldsFromBody", () => {
  it("stores only the 11-char id when source is youtube", () => {
    assert.deepEqual(
      sourceFieldsFromBody({
        source: "youtube",
        youtubeUrl: `https://www.youtube.com/watch?v=${ID}`,
      }),
      { source: "youtube", youtubeVideoId: ID }
    );
    assert.deepEqual(
      sourceFieldsFromBody({ source: "youtube", youtubeVideoId: `https://youtu.be/${ID}` }),
      { source: "youtube", youtubeVideoId: ID }
    );
    assert.deepEqual(sourceFieldsFromBody({ source: "webrtc" }, { source: "youtube", youtube_video_id: ID }), {
      source: "webrtc",
      youtubeVideoId: null,
    });
  });

  it("infers youtube from a URL and keeps an existing id", () => {
    assert.deepEqual(sourceFieldsFromBody({ youtubeUrl: ID }), {
      source: "youtube",
      youtubeVideoId: ID,
    });
    assert.deepEqual(
      sourceFieldsFromBody({ source: "youtube" }, { youtube_video_id: ID }),
      { source: "youtube", youtubeVideoId: ID }
    );
  });

  it("rejects stream keys and webrtc+url combinations", () => {
    assert.equal(sourceFieldsFromBody({ isEnabled: true }), null);
    assert.throws(
      () => sourceFieldsFromBody({ source: "youtube", youtubeVideoId: "xxxx-xxxx-xxxx-xxxx" }),
      (err) => err.statusCode === 400
    );
    assert.throws(
      () => sourceFieldsFromBody({ source: "webrtc", youtubeUrl: `https://youtu.be/${ID}` }),
      (err) => err.statusCode === 400 && /youtubeUrl/.test(err.message)
    );
    assert.throws(
      () => sourceFieldsFromBody({ source: "youtube" }),
      (err) => err.statusCode === 400 && /required/.test(err.message)
    );
    assert.throws(
      () => sourceFieldsFromBody({ source: "rtmp" }),
      (err) => err.statusCode === 400 && /webrtc or youtube/.test(err.message)
    );
  });
});

describe("youtubeVideoIdForClient / signalling", () => {
  const youtube = { source: "youtube", youtube_video_id: ID, is_enabled: true };

  it("hides the video id unless reveal is true", () => {
    assert.equal(youtubeVideoIdForClient(youtube, { reveal: true }), ID);
    assert.equal(youtubeVideoIdForClient(youtube, { reveal: false }), null);
    assert.equal(youtubeVideoIdForClient(youtube), null);
    assert.equal(youtubeVideoIdForClient({ source: "webrtc", youtube_video_id: ID }, { reveal: true }), null);
    assert.equal(cameraSource({}), "webrtc");
    assert.equal(isYoutubeCamera(youtube), true);
  });

  it("400s ICE/signalling for youtube cameras", () => {
    assert.throws(
      () => assertWebrtcSignalling(youtube),
      (err) =>
        err.statusCode === 400 && err.message === "ICE and signalling are not used for YouTube cameras"
    );
    assert.doesNotThrow(() => assertWebrtcSignalling({ source: "webrtc" }));
  });
});
