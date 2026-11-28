import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, {
  passwordHash,
  safeEqual,
  scan,
  deliver,
  collect,
  credentials,
} from "../src/worker.mjs";
import {
  DEFAULT,
  schedule,
  classify,
  parseRSS,
  validateSettings,
  csvCell,
  hash,
} from "../src/core.mjs";
function env() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../db/migrations/0001_existing_schema.sql", import.meta.url),
      "utf8",
    ),
  );
  db.prepare("INSERT INTO settings VALUES(1,?)").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
    }),
  );
  db.prepare("INSERT INTO auth VALUES(1,NULL,NULL,NULL,NULL)").run();
  const prepare = (query) => ({
    query,
    params: [],
    bind(...params) {
      this.params = params;
      return this;
    },
    async first() {
      return db.prepare(query).get(...this.params) || null;
    },
    async all() {
      return { results: db.prepare(query).all(...this.params) };
    },
    async run() {
      const r = db.prepare(query).run(...this.params);
      return { meta: { changes: r.changes } };
    },
  });
  return {
    DB: {
      prepare,
      async batch(statements) {
        db.exec("BEGIN");
        try {
          const results = [];
          for (const s of statements)
            results.push(
              /^SELECT/.test(s.query) ? await s.all() : await s.run(),
            );
          db.exec("COMMIT");
          return results;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    },
    db,
  };
}
const iso = (s) => Date.parse(s + "+07:00");
test("schedule preserves office, holiday and weekend intervals", () => {
  for (const [a, b, h = []] of [
    ["2026-11-26T08:29:00", "2026-11-26T08:30:00"],
    ["2026-11-26T15:30:00", "2026-11-26T16:30:00"],
    ["2026-11-26T16:30:00", "2026-11-26T20:30:00"],
    ["2026-11-28T08:30:00", "2026-11-28T12:30:00"],
    ["2026-12-10T08:30:00", "2026-12-10T12:30:00", ["2026-12-10"]],
    ["2026-11-30T00:15:00", "2026-11-30T00:30:00"],
  ])
    assert.equal(schedule(iso(a), h).next, iso(b));
});
test("RSS, Thai sentiment and CSV safety", () => {
  const a = parseRSS(
    "<rss><channel><item><title>SiPH ขอบคุณ &amp; ประทับใจ</title><link>https://example.org/a</link><source>News</source></item></channel></rss>",
  );
  assert.equal(a.length, 1);
  assert.equal(a[0].title, "SiPH ขอบคุณ & ประทับใจ");
  assert.equal(classify(a[0].text)[0], "positive");
  assert.equal(classify("SiPH รอนาน")[0], "negative");
  assert.equal(csvCell("=cmd"), '"\'=cmd"');
});
test("validates settings dates and recipient", () => {
  assert.throws(() => validateSettings(DEFAULT, { holidays: ["2026-02-30"] }));
  assert.throws(() => validateSettings(DEFAULT, { email_to: "bad" }));
  assert.throws(() => validateSettings(DEFAULT, { line_to: "bad" }));
  assert.throws(() => validateSettings(DEFAULT, { keywords: [] }));
  assert.deepEqual(
    validateSettings(DEFAULT, { holidays: ["2026-12-10"] }).holidays,
    ["2026-12-10"],
  );
});
test("password hash and constant-time verification helper", async () => {
  const h = await passwordHash("test-password-123", "salt");
  assert.equal(h.length, 64);
  assert.equal(
    await safeEqual(h, await passwordHash("test-password-123", "salt")),
    true,
  );
  assert.equal(await safeEqual(h, await passwordHash("wrong", "salt")), false);
});
test("credentials come exclusively from environment secrets, never from legacy D1", async () => {
  const e = env();
  e.RESEND_API_KEY = "test-only-email-secret";
  e.EMAIL_FROM = "sender@example.org";
  e.LINE_CHANNEL_ACCESS_TOKEN = "test-only-line-secret";
  const keys = credentials(e);
  assert.equal(keys.email_api_key, e.RESEND_API_KEY);
  assert.equal(keys.line_token, e.LINE_CHANNEL_ACCESS_TOKEN);
  assert.equal(
    e.db.prepare("SELECT COUNT(*) AS n FROM integrations").get().n,
    0,
  );
  assert.equal(credentials({}).email_api_key, "");
});
test("unauthenticated API rejected; login page public; cross-site write blocked", async () => {
  const e = env(),
    ctx = { waitUntil() {} };
  let r = await worker.fetch(
    new Request("https://monitor.test/api/state"),
    e,
    ctx,
  );
  assert.equal(r.status, 401);
  r = await worker.fetch(new Request("https://monitor.test/"), e, ctx);
  assert.match(await r.text(), /เข้าสู่ระบบผู้ดูแล/);
  r = await worker.fetch(
    new Request("https://monitor.test/api/settings", {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
    e,
    ctx,
  );
  assert.equal(r.status, 403);
});
test("setup link single use, session cookie and password login", async () => {
  const e = env(),
    ctx = { waitUntil() {} };
  e.db
    .prepare("UPDATE auth SET setup_hash=?,setup_expires=?")
    .run(await hash("setup-token"), Date.now() + 60000);
  const post = (path, data) =>
    worker.fetch(
      new Request("https://monitor.test" + path, {
        method: "POST",
        headers: {
          Origin: "https://monitor.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }),
      e,
      ctx,
    );
  let r = await post("/auth/setup", {
    token: "setup-token",
    password: "long-test-password",
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  r = await worker.fetch(
    new Request("https://monitor.test/api/state", {
      headers: { Cookie: cookie.split(";")[0] },
    }),
    e,
    ctx,
  );
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.deepEqual(s.articles, []);
  assert.equal(s.runtime, "cloudflare");
  r = await post("/auth/setup", {
    token: "setup-token",
    password: "long-test-password",
  });
  assert.equal(r.status, 403);
  r = await post("/auth/login", { password: "wrong" });
  assert.equal(r.status, 401);
  r = await post("/auth/login", { password: "long-test-password" });
  assert.equal(r.status, 200);
});
test("scan deduplicates news and creates one outbox per enabled channel", async (t) => {
  const e = env();
  e.db.prepare("UPDATE settings SET data=?").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
      email_enabled: true,
      line_enabled: true,
    }),
  );
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        "<rss><channel><item><title>SiPH ขอบคุณ</title><link>https://example.org/a</link><guid>same</guid></item></channel></rss>",
      ),
  );
  assert.equal((await scan(e)).added, 1);
  e.db.prepare("UPDATE runs SET started='2000-01-01'").run();
  assert.equal((await scan(e)).added, 0);
  assert.equal(e.db.prepare("SELECT count(*) AS n FROM articles").get().n, 1);
  assert.equal(e.db.prepare("SELECT count(*) AS n FROM deliveries").get().n, 2);
});
test("scheduled scan skips persisted current slot and pause state", async (t) => {
  const e = env();
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<rss><channel></channel></rss>"),
  );
  await scan(e, { scheduled: true });
  assert.equal((await scan(e, { scheduled: true })).skipped, true);
  assert.equal(mock.mock.callCount(), 1);
  e.db.prepare("UPDATE settings SET data=?").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
      paused: true,
    }),
  );
  assert.equal((await scan(e, { scheduled: true })).paused, true);
});
test("outbox retries five times then stops", async () => {
  const e = env();
  e.db.prepare("UPDATE settings SET data=?").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
      email_enabled: true,
    }),
  );
  e.db
    .prepare(
      "INSERT INTO articles(id,title,url,sentiment,run_id) VALUES('a','test','https://example.org','neutral','test')",
    )
    .run();
  e.db
    .prepare(
      "INSERT INTO deliveries(article_id,channel,next_try,retry_key) VALUES('a','email',0,'key')",
    )
    .run();
  for (let i = 0; i < 5; i++) {
    e.db.prepare("UPDATE deliveries SET next_try=0").run();
    await deliver(e);
  }
  const r = e.db.prepare("SELECT * FROM deliveries").get();
  assert.equal(r.status, "failed");
  assert.equal(r.attempts, 5);
});
test("LINE delivery idempotency conflict is treated as already accepted", async (t) => {
  const e = env();
  e.db.prepare("UPDATE settings SET data=?").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
      line_enabled: true,
      line_to: "U" + "1".repeat(32),
    }),
  );
  e.LINE_CHANNEL_ACCESS_TOKEN = "test-only-line-secret";
  e.db
    .prepare(
      "INSERT INTO articles(id,title,url,sentiment,run_id) VALUES('a','test','https://example.org','neutral','test')",
    )
    .run();
  e.db
    .prepare(
      "INSERT INTO deliveries(article_id,channel,next_try,retry_key) VALUES('a','line',0,'stable-key')",
    )
    .run();
  const mock = t.mock.method(globalThis, "fetch", async (u, opts) => {
    assert.equal(opts.headers["X-Line-Retry-Key"], "stable-key");
    return new Response("", {
      status: 409,
      headers: { "x-line-accepted-request-id": "accepted-id" },
    });
  });
  await deliver(e);
  await deliver(e);
  assert.equal(
    e.db.prepare("SELECT status FROM deliveries").get().status,
    "sent",
  );
  assert.equal(mock.mock.callCount(), 1);
});
test("Bing fallback canonicalizes redirect links and preserves one warning", async (t) => {
  const e = env();
  t.mock.method(globalThis, "fetch", async (url) =>
    url.includes("news.google.com")
      ? new Response("unavailable", { status: 503 })
      : new Response(
          "<rss><channel><item><title>SiPH ขอบคุณ</title><link>http://www.bing.com/news/apiclick.aspx?tid=1&amp;url=https%3A%2F%2Fexample.org%2Fnews</link></item></channel></rss>",
        ),
  );
  const result = await scan(e);
  assert.equal(result.added, 1);
  assert.equal(result.partial, true);
  const a = e.db.prepare("SELECT * FROM articles").get();
  assert.equal(a.url, "https://example.org/news");
  assert.equal(a.source, "Bing News");
  assert.equal(e.db.prepare("SELECT status FROM runs").get().status, "partial");
});
test("Thai negation and mixed sentiment require context", () => {
  assert.equal(classify("SiPH ไม่แพง")[0], "positive");
  assert.equal(classify("SiPH ไม่ประทับใจ")[0], "negative");
  assert.equal(classify("SiPH ไม่ต้องรอนาน")[0], "positive");
  assert.equal(classify("ขอบคุณ SiPH แต่รอนาน")[0], "neutral");
  assert.equal(classify("SiPH ให้ความรู้การดูแลผู้ป่วยเสียชีวิต")[0], "neutral");
});
test("social adapter accepts text posts, authenticates once, and skips malformed or unrelated records", async (t) => {
  const e = env();
  e.SOCIAL_FEED_URL = "https://social.example.org/feed";
  e.SOCIAL_FEED_TOKEN = "test-only-provider-token";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.includes("news.google.com"))
      return new Response("<rss><channel/></rss>");
    assert.equal(
      options.headers.Authorization,
      "Bearer " + e.SOCIAL_FEED_TOKEN,
    );
    assert.equal(options.redirect, "manual");
    return Response.json({
      data: [
        null,
        {
          text: "ขอบคุณ SiPH",
          url: "https://social.example.org/post/1#comment",
          platform: "Facebook",
        },
        { title: "unrelated", url: "https://example.org/2" },
        { title: "SiPH", url: "http://example.org/3" },
        { title: "SiPH", url: "https://user:password@example.org/4" },
      ],
    });
  });
  const r = await scan(e);
  assert.equal(r.added, 1);
  const a = e.db.prepare("SELECT * FROM articles").get();
  assert.equal(a.url, "https://social.example.org/post/1");
  assert.equal(a.source, "Facebook");
  assert.equal(a.sentiment, "positive");
});
test("social API parsing failures do not discard online news or leak provider bodies", async (t) => {
  const e = env();
  e.SOCIAL_FEED_URL = "https://social.example.org/feed";
  t.mock.method(
    globalThis,
    "fetch",
    async (u) =>
      new Response(
        u.includes("news.google.com")
          ? "<rss><channel><item><title>SiPH ข่าว</title><link>https://example.org/a</link></item></channel></rss>"
          : "bad json containing private-provider-value",
      ),
  );
  const r = await scan(e);
  assert.equal(r.added, 1);
  assert.equal(r.partial, true);
  assert.doesNotMatch(
    e.db.prepare("SELECT message FROM runs").get().message,
    /private-provider-value/,
  );
});
test("disabled email backlog cannot starve enabled LINE deliveries", async (t) => {
  const e = env();
  e.LINE_CHANNEL_ACCESS_TOKEN = "test-only-line-secret";
  e.db.prepare("UPDATE settings SET data=?").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
      line_enabled: true,
      line_to: "U" + "1".repeat(32),
    }),
  );
  e.db
    .prepare(
      "INSERT INTO articles(id,title,url,sentiment,run_id) VALUES('a','test','https://example.org','neutral','test')",
    )
    .run();
  for (let i = 0; i < 6; i++) {
    e.db
      .prepare(
        "INSERT INTO deliveries(article_id,channel,next_try,retry_key) VALUES(?,?,0,?)",
      )
      .run("email" + i, "email", "key" + i);
    e.db
      .prepare(
        "INSERT INTO articles(id,title,url,sentiment,run_id) VALUES(?,?,?,?,?)",
      )
      .run("email" + i, "test", "https://example.org/" + i, "neutral", "test");
  }
  e.db
    .prepare(
      "INSERT INTO deliveries(article_id,channel,next_try,retry_key) VALUES('a','line',0,'stable')",
    )
    .run();
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}"),
  );
  await deliver(e);
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(
    e.db.prepare("SELECT status FROM deliveries WHERE channel='line'").get()
      .status,
    "sent",
  );
});
test("LINE conflict without accepted request header remains retryable", async (t) => {
  const e = env();
  e.LINE_CHANNEL_ACCESS_TOKEN = "test-only-line-secret";
  e.db.prepare("UPDATE settings SET data=?").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
      line_enabled: true,
      line_to: "U" + "1".repeat(32),
    }),
  );
  e.db
    .prepare(
      "INSERT INTO articles(id,title,url,sentiment,run_id) VALUES('a','test','https://example.org','neutral','test')",
    )
    .run();
  e.db
    .prepare(
      "INSERT INTO deliveries(article_id,channel,next_try,retry_key) VALUES('a','line',0,'key')",
    )
    .run();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}", { status: 409 }),
  );
  await deliver(e);
  assert.equal(
    e.db.prepare("SELECT status FROM deliveries").get().status,
    "pending",
  );
});
test("email uses stable idempotency key and secret-bound sender", async (t) => {
  const e = env();
  e.RESEND_API_KEY = "test-only-email-secret";
  e.EMAIL_FROM = "sender@example.org";
  e.db.prepare("UPDATE settings SET data=?").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
      email_enabled: true,
      email_to: "recipient@example.org",
    }),
  );
  e.db
    .prepare(
      "INSERT INTO articles(id,title,url,sentiment,run_id) VALUES('a','test','https://example.org','positive','test')",
    )
    .run();
  e.db
    .prepare(
      "INSERT INTO deliveries(article_id,channel,next_try,retry_key) VALUES('a','email',0,'stable-key')",
    )
    .run();
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(opts.headers["Idempotency-Key"], "siph-stable-key");
    assert.equal(opts.headers.Authorization, "Bearer " + e.RESEND_API_KEY);
    assert.deepEqual(JSON.parse(opts.body).to, ["recipient@example.org"]);
    return Response.json({ id: "accepted" });
  });
  await deliver(e);
  assert.equal(
    e.db.prepare("SELECT status FROM deliveries").get().status,
    "sent",
  );
});
test("API never accepts integration secrets and aggregate counts cover more than 1000 records", async () => {
  const e = env(),
    token = "a".repeat(64),
    cookie = "__Host-siph=" + token,
    ctx = { waitUntil() {} };
  e.RESEND_API_KEY = "test-only-email-secret";
  e.db
    .prepare("INSERT INTO sessions VALUES(?,?)")
    .run(await hash(token), Date.now() + 60000);
  const stmt = e.db.prepare(
    "INSERT INTO articles(id,title,url,sentiment,run_id) VALUES(?,?,?,?,?)",
  );
  for (let i = 0; i < 1005; i++)
    stmt.run(String(i), "test", "https://example.org/" + i, "positive", "test");
  let r = await worker.fetch(
    new Request("https://monitor.test/api/state", {
      headers: { Cookie: cookie },
    }),
    e,
    ctx,
  );
  const state = await r.json();
  assert.equal(state.articles.length, 1000);
  assert.equal(state.stats.total, 1005);
  assert.equal(state.stats.positive, 1005);
  assert.doesNotMatch(JSON.stringify(state), /test-only-email-secret/);
  r = await worker.fetch(
    new Request("https://monitor.test/api/integrations", {
      method: "POST",
      headers: {
        Origin: "https://monitor.test",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ email_api_key: "must-not-save" }),
    }),
    e,
    ctx,
  );
  assert.equal(r.status, 405);
  assert.equal(
    e.db.prepare("SELECT COUNT(*) AS n FROM integrations").get().n,
    0,
  );
});
test("lease lock prevents overlapping collectors", async (t) => {
  const e = env();
  e.db
    .prepare("INSERT INTO locks VALUES(?,?,?)")
    .run("scan", "other-run", Date.now() + 60000);
  const mock = t.mock.method(globalThis, "fetch", async () => {
    throw Error("should never call network");
  });
  assert.equal((await scan(e)).busy, true);
  assert.equal(mock.mock.callCount(), 0);
});
test("review gate rejects unmerged PRs and mismatched commits", async () => {
  const { verifyReview } = await import("../scripts/deploy.mjs");
  const pr = {
    merged: true,
    merge_commit_sha: "abc",
    base: { ref: "main", repo: { full_name: "Merp071/siph-monitor" } },
  };
  verifyReview(pr, "abc", "Merp071/siph-monitor", "main");
  assert.throws(() =>
    verifyReview(
      { ...pr, merged: false },
      "abc",
      "Merp071/siph-monitor",
      "main",
    ),
  );
  assert.throws(() =>
    verifyReview(pr, "other", "Merp071/siph-monitor", "main"),
  );
});
test("baseline schema adoption preserves existing articles and authentication", () => {
  const e = env();
  e.db
    .prepare(
      "UPDATE auth SET salt='existing-salt',password_hash='existing-hash'",
    )
    .run();
  e.db
    .prepare(
      "INSERT INTO articles(id,title,url,sentiment,run_id) VALUES('old','existing','https://example.org/old','neutral','legacy')",
    )
    .run();
  e.db.exec(
    readFileSync(
      new URL("../db/migrations/0001_existing_schema.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 1);
  assert.equal(
    e.db.prepare("SELECT password_hash FROM auth").get().password_hash,
    "existing-hash",
  );
});
test("public Bluesky defaults apply to old settings without a schema migration", async (t) => {
  const e = env();
  const old = { ...DEFAULT };
  delete old.bluesky_enabled;
  delete old.youtube_enabled;
  e.db.prepare("UPDATE settings SET data=?").run(JSON.stringify(old));
  t.mock.method(
    globalThis,
    "fetch",
    async (url) =>
      new Response(
        url.startsWith("https://api.bsky.app/")
          ? JSON.stringify({
              posts: [
                {
                  uri: "at://did:plc:example/app.bsky.feed.post/abc123",
                  record: {
                    text: "ขอบคุณ SiPH คุณหมอดูแลดี",
                    createdAt: new Date().toISOString(),
                  },
                },
              ],
            })
          : "<rss><channel/></rss>",
      ),
  );
  assert.equal((await scan(e)).added, 1);
  assert.equal(
    e.db.prepare("SELECT source FROM articles").get().source,
    "Bluesky",
  );
});
test("YouTube metadata expires without removing other sources or authentication", async () => {
  const { expireYouTube } = await import("../src/worker.mjs");
  const e = env();
  const s = e.db.prepare(
    "INSERT INTO articles(id,title,url,source,found,sentiment,run_id) VALUES(?,?,?,?,?,?,?)",
  );
  s.run(
    "old-y",
    "video",
    "https://example.org/old",
    "YouTube",
    "2020-01-01",
    "neutral",
    "test",
  );
  s.run(
    "news",
    "news",
    "https://example.org/news",
    "Google News",
    "2020-01-01",
    "neutral",
    "test",
  );
  s.run(
    "new-y",
    "video",
    "https://example.org/new",
    "YouTube",
    new Date().toISOString(),
    "neutral",
    "test",
  );
  e.db
    .prepare(
      "INSERT INTO deliveries(article_id,channel,next_try,retry_key) VALUES('old-y','email',0,'old')",
    )
    .run();
  await expireYouTube(e);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 2);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM deliveries").get().n, 0);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM auth").get().n, 1);
});
test("exclusion preferences validate URLs and preserve old configurations", () => {
  assert.equal(
    validateSettings(DEFAULT, { google_alerts_enabled: false })
      .google_alerts_enabled,
    false,
  );
  assert.throws(() =>
    validateSettings(DEFAULT, { excluded_urls: ["javascript:alert(1)"] }),
  );
  assert.throws(() =>
    validateSettings(DEFAULT, {
      excluded_urls: ["https://user:pass@example.org"],
    }),
  );
  assert.deepEqual(
    validateSettings(DEFAULT, {
      excluded_urls: ["https://facebook.com/Official"],
    }).excluded_urls,
    ["https://facebook.com/Official"],
  );
});
test("Google Alerts imports deduplicate and persist snippet-only sentiment provenance", async (t) => {
  const e = env();
  const feed = "https://www.google.com/alerts/feeds/fixture/account";
  e.GOOGLE_ALERTS_FEEDS = JSON.stringify([feed]);
  t.mock.method(
    globalThis,
    "fetch",
    async (url) =>
      new Response(
        url === feed
          ? '<feed><entry><title>SiPH คุณหมอดูแลดี</title><link href="https://pantip.com/topic/123"/></entry></feed>'
          : "<rss><channel/></rss>",
      ),
  );
  assert.equal((await scan(e)).added, 1);
  const a = e.db.prepare("SELECT * FROM articles").get();
  assert.equal(a.source, "Pantip · Google Alerts");
  assert.match(a.reason, /ข้อความย่อ Google Alerts/);
  e.db.prepare("UPDATE runs SET started='2000-01-01'").run();
  assert.equal((await scan(e)).added, 0);
});
test("source setup exposes only feed count and never the private feed links", async () => {
  const e = env();
  e.GOOGLE_ALERTS_FEEDS = JSON.stringify([
    "https://www.google.com/alerts/feeds/fixture/private",
  ]);
  const token = "b".repeat(64);
  e.db
    .prepare("INSERT INTO sessions VALUES(?,?)")
    .run(await hash(token), Date.now() + 60000);
  const r = await worker.fetch(
    new Request("https://monitor.test/api/state", {
      headers: { Cookie: "__Host-siph=" + token },
    }),
    e,
    { waitUntil() {} },
  );
  const s = await r.json();
  assert.equal(s.google_alerts_setup.count, 1);
  assert.equal(s.connections.google_alerts, true);
  assert.equal(s.mention_queries.length, 5);
  assert.doesNotMatch(JSON.stringify(s), /\/alerts\/feeds\/fixture/);
});
test("official URL exclusions apply to newly collected sources without deleting history", async (t) => {
  const e = env();
  e.db.prepare("UPDATE settings SET data=?").run(
    JSON.stringify({
      ...DEFAULT,
      bluesky_enabled: false,
      youtube_enabled: false,
      excluded_urls: ["https://official.example.org/"],
    }),
  );
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        "<rss><channel><item><title>SiPH ขอบคุณ</title><link>https://official.example.org/post/1</link></item></channel></rss>",
      ),
  );
  assert.equal((await scan(e)).added, 0);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 0);
});
