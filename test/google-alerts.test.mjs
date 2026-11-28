import test from "node:test";
import assert from "node:assert/strict";
import {
  alertFeedConfig,
  canonicalAlertURL,
  excludedURL,
  parseAlertFeed,
  collectAlerts,
  mentionSearchQueries,
} from "../src/google-alerts.mjs";
const feed = "https://www.google.com/alerts/feeds/fixture/account",
  keywords = ["SiPH", "ศิริราชปิยมหาราชการุณย์"];
function atom(
  target = "https://www.facebook.com/visitor/posts/123",
  title = "ขอบคุณ SiPH คุณหมอดูแลดี",
) {
  const link =
    "https://www.google.com/url?url=" +
    encodeURIComponent(target) +
    "&amp;ct=ga&amp;secret=must-not-store";
  return (
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>private-feed-entry-id</id><title type="html">' +
    title +
    '</title><link rel="alternate" href="' +
    link +
    '"/><published>2026-11-28T01:00:00Z</published><content type="html">รีวิว &lt;b&gt;โรงพยาบาล&lt;/b&gt; บริการดี</content></entry></feed>'
  );
}
test("feed configuration accepts only explicit HTTPS Google Alerts feed paths", () => {
  assert.equal(alertFeedConfig("").status, "missing");
  assert.equal(alertFeedConfig(JSON.stringify([feed, feed])).urls.length, 1);
  for (const url of [
    "http://www.google.com/alerts/feeds/a/b",
    "https://evil.test/alerts/feeds/a/b",
    "https://www.google.com.evil.test/alerts/feeds/a/b",
    "https://u:p@www.google.com/alerts/feeds/a/b",
    "https://www.google.com/url?a=b",
    feed + "?q=private",
    feed + "#private",
    "https://www.google.com:8443/alerts/feeds/a/b",
  ])
    assert.equal(alertFeedConfig(JSON.stringify([url])).status, "invalid", url);
  assert.equal(alertFeedConfig("not-json").status, "invalid");
  assert.equal(
    alertFeedConfig(JSON.stringify(Array(11).fill(feed))).status,
    "invalid",
  );
});
test("Atom importer strips Google tracking and HTML and preserves indexed-result provenance", () => {
  const records = parseAlertFeed(
    atom(
      "https://www.facebook.com/visitor/posts/123?utm_source=g&fbclid=tracking",
    ),
    keywords,
  );
  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.url, "https://www.facebook.com/visitor/posts/123");
  assert.equal(r.source, "Facebook · Google Alerts");
  assert.equal(r.discovery, "google-alerts");
  assert.equal(r.guid, "google-alerts:" + r.url);
  assert.doesNotMatch(r.text, /<b>/);
  assert.doesNotMatch(
    JSON.stringify(r),
    /private-feed-entry-id|must-not-store|fbclid/,
  );
});
test("RSS and namespaced Atom formats import the same target with stable deduplication key", () => {
  const rss =
    "<rss><channel><item><title>SiPH คุณหมอบริการดี</title><link>https://pantip.com/topic/123</link><description>รีวิว</description></item></channel></rss>";
  const a = parseAlertFeed(rss, keywords)[0],
    b = parseAlertFeed(atom("https://pantip.com/topic/123"), keywords)[0];
  assert.equal(a.guid, b.guid);
  assert.equal(a.source, "Pantip · Google Alerts");
  const ns = atom()
    .replaceAll("<feed", "<atom:feed")
    .replaceAll("</feed", "</atom:feed")
    .replace("xmlns=", "xmlns:atom=");
  assert.equal(parseAlertFeed(ns, keywords).length, 1);
});
test("canonical target permits only HTTPS destinations and keeps meaningful identity parameters", () => {
  assert.equal(canonicalAlertURL("javascript:alert(1)"), null);
  assert.equal(canonicalAlertURL("https://user:pass@example.org/post"), null);
  assert.equal(
    canonicalAlertURL("https://www.google.com/alerts/feeds/a/b"),
    null,
  );
  assert.equal(
    canonicalAlertURL(
      "https://www.google.com/url?q=" +
        encodeURIComponent(
          "https://facebook.com/story.php?story_fbid=2&id=1&utm_campaign=x#comments",
        ),
    ),
    "https://facebook.com/story.php?id=1&story_fbid=2",
  );
});
test("official account exclusions respect host, path boundaries, query identity and mobile variants", () => {
  const rules = [
    "https://www.facebook.com/Official",
    "https://facebook.com/profile.php?id=123",
  ];
  assert.equal(
    excludedURL("https://m.facebook.com/official/posts/1", rules),
    true,
  );
  assert.equal(
    excludedURL("https://www.facebook.com/OfficialFan/posts/1", rules),
    false,
  );
  assert.equal(
    excludedURL("https://facebook.com.evil.test/Official/posts/1", rules),
    false,
  );
  assert.equal(
    excludedURL("https://facebook.com/profile.php?id=999", rules),
    false,
  );
  assert.equal(
    excludedURL("https://facebook.com/profile.php?id=123", rules),
    true,
  );
  assert.equal(
    parseAlertFeed(
      atom("https://facebook.com/Official/posts/1"),
      keywords,
      rules,
    ).length,
    0,
  );
});
test("importer rejects DTDs, invalid feeds, unsafe links and unrelated SiPh technology", () => {
  assert.throws(() =>
    parseAlertFeed('<!DOCTYPE feed [<!ENTITY x "y">]><feed/>', keywords),
  );
  assert.throws(() => parseAlertFeed("<html>not a feed</html>", keywords));
  assert.deepEqual(parseAlertFeed("<feed/>", keywords), []);
  assert.deepEqual(parseAlertFeed("<rss><channel/></rss>", keywords), []);
  assert.equal(parseAlertFeed(atom("javascript:alert(1)"), keywords).length, 0);
  assert.equal(
    parseAlertFeed(atom("https://example.org/post", "SiPh silicon chips"), [
      "different hospital keyword",
    ]).length,
    0,
  );
});
test("feed collection retains working sources and errors never expose private feed URLs", async () => {
  const two = "https://www.google.com/alerts/feeds/fixture/second";
  const r = await collectAlerts(
    { google_alerts_enabled: true, keywords, excluded_urls: [] },
    JSON.stringify([feed, two]),
    async (url) => {
      if (url === feed) throw Error("HTTP 503 " + feed);
      return atom();
    },
  );
  assert.equal(r.records.length, 1);
  assert.equal(r.success, 1);
  assert.deepEqual(r.errors, ["Google Alerts #1: HTTP 503"]);
  assert.equal(JSON.stringify(r).includes("/alerts/feeds/"), false);
});
test("disabled, missing and invalid configurations never invoke the network", async () => {
  let calls = 0;
  const read = async () => {
    calls++;
    return atom();
  };
  const config = { google_alerts_enabled: true, keywords };
  await collectAlerts(
    { ...config, google_alerts_enabled: false },
    JSON.stringify([feed]),
    read,
  );
  await collectAlerts(config, "", read);
  const invalid = await collectAlerts(config, "invalid-private-value", read);
  assert.equal(calls, 0);
  assert.equal(invalid.errors.length, 1);
  assert.doesNotMatch(JSON.stringify(invalid), /invalid-private-value/);
});
test("feed collection bounds concurrency, deduplicates across feeds and caps total imported records", async () => {
  let active = 0,
    max = 0;
  const feeds = Array.from(
    { length: 7 },
    (_, i) => "https://www.google.com/alerts/feeds/fixture/feed" + i,
  );
  const r = await collectAlerts(
    { google_alerts_enabled: true, keywords },
    JSON.stringify(feeds),
    async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return atom();
    },
  );
  assert.ok(max <= 3);
  assert.equal(r.success, 7);
  assert.equal(r.records.length, 1);
  let n = 0;
  const many =
    "<feed>" +
    Array.from(
      { length: 100 },
      () =>
        '<entry><title>SiPH โรงพยาบาล</title><link href="https://pantip.com/topic/' +
        ++n +
        '"/></entry>',
    ).join("") +
    "</feed>";
  const capped = await collectAlerts(
    { google_alerts_enabled: true, keywords },
    JSON.stringify(feeds),
    async () => many,
  );
  assert.equal(capped.records.length, 100);
});
test("search shortcuts cover all requested domains and use examples without account secrets", () => {
  const q = mentionSearchQueries(keywords);
  assert.equal(q.length, 5);
  assert.ok(
    q.find((x) => x.platform === "X").query.includes("site:twitter.com"),
  );
  assert.ok(
    q.find((x) => x.platform === "Pantip").query.includes("site:pantip.com"),
  );
  assert.ok(q.every((x) => x.query.includes('"SiPH"')));
});
