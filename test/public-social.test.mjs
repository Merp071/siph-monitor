import test from "node:test";
import assert from "node:assert/strict";
import {
  blueskyRecords,
  youtubeRecords,
  relevantHospitalMention,
  collectPublicSocial,
} from "../src/public-social.mjs";
const now = Date.parse("2026-11-27T12:00:00Z"),
  keywords = ["SiPH", "ศิริราชปิยมหาราชการุณย์"];
const post = (
  text = "ขอบคุณ SiPH คุณหมอดูแลดี",
  uri = "at://did:plc:example/app.bsky.feed.post/abc123",
) => ({
  uri,
  record: { text, createdAt: new Date(now - 60000).toISOString() },
});
test("hospital relevance rejects SiPh technology and Siphona false positives", () => {
  assert.equal(
    relevantHospitalMention(
      "SiPh silicon photonics chip manufacturing",
      keywords,
    ),
    false,
  );
  assert.equal(
    relevantHospitalMention("Siphona geniculata hospital", keywords),
    false,
  );
  assert.equal(relevantHospitalMention("ที่SiPHบริการดีมาก", keywords), true);
  assert.equal(
    relevantHospitalMention("ศิริราชปิยมหาราชการุณย์ เปิดบริการ", keywords),
    true,
  );
  assert.equal(
    relevantHospitalMention("SiPH hospital appointment", keywords),
    true,
  );
});
test("Bluesky normalizes public post identity and rejects stale or malformed records", () => {
  const posts = [
    post(),
    post("SiPh silicon chip"),
    post("SiPH คุณหมอ", "https://attacker.invalid"),
    { ...post(), record: { text: "SiPH คุณหมอ", createdAt: "2020-01-01" } },
    null,
  ];
  const records = blueskyRecords({ posts }, keywords, now);
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "Bluesky");
  assert.equal(records[0].guid, post().uri);
  assert.match(records[0].url, /^https:\/\/bsky.app\/profile\//);
  assert.throws(() => blueskyRecords({}, keywords, now));
});
test("YouTube normalizes public metadata and excludes unrelated or malformed videos", () => {
  const item = {
    id: { videoId: "Abcdefgh_12" },
    snippet: {
      title: "รีวิว SiPH hospital",
      description: "คุณหมอดูแลดี",
      publishedAt: new Date(now - 60000).toISOString(),
    },
  };
  const records = youtubeRecords(
    {
      items: [
        item,
        { ...item, id: { videoId: "bad" } },
        {
          ...item,
          snippet: {
            ...item.snippet,
            title: "SiPh chip",
            description: "semiconductor",
          },
        },
      ],
    },
    keywords,
    now,
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].url, "https://www.youtube.com/watch?v=Abcdefgh_12");
  assert.equal(records[0].guid, "youtube:Abcdefgh_12");
});
test("no YouTube request without a key and disabled sources make no requests", async () => {
  let calls = 0;
  const reader = async () => {
    calls++;
    return { posts: [] };
  };
  await collectPublicSocial(
    { keywords, bluesky_enabled: false, youtube_enabled: true },
    {},
    reader,
    now,
  );
  assert.equal(calls, 0);
  await collectPublicSocial(
    { keywords, bluesky_enabled: true, youtube_enabled: true },
    {},
    reader,
    now,
  );
  assert.equal(calls, 1);
});
test("YouTube API key is header-only; provider failure does not discard Bluesky", async () => {
  const secret = "test-only-youtube-secret";
  let calls = 0;
  const r = await collectPublicSocial(
    { keywords, bluesky_enabled: true, youtube_enabled: true },
    { youtube_api_key: secret },
    async (url, headers) => {
      calls++;
      assert.equal(url.includes(secret), false);
      if (url.startsWith("https://api.bsky.app/")) return { posts: [post()] };
      assert.equal(headers["X-Goog-Api-Key"], secret);
      throw Error("HTTP 429 private-provider-response " + secret);
    },
    now,
  );
  assert.equal(calls, 2);
  assert.equal(r.records.length, 1);
  assert.equal(r.success, 1);
  assert.deepEqual(r.errors, ["YouTube: HTTP 429"]);
  assert.equal(JSON.stringify(r).includes(secret), false);
});
test("malformed public responses report source errors without leaking bodies", async () => {
  const r = await collectPublicSocial(
    { keywords, bluesky_enabled: true, youtube_enabled: false },
    {},
    async () => ({ private: "must-not-leak" }),
    now,
  );
  assert.equal(r.success, 0);
  assert.equal(r.errors.length, 1);
  assert.doesNotMatch(JSON.stringify(r), /must-not-leak/);
});
