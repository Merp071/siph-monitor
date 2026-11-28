import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { DEFAULT, hash } from "../src/core.mjs";

test("Workers runtime: real D1, auth, secrets and durable scheduled outbox", async () => {
  const deliveries = [];
  const mf = new Miniflare({
    modules: true,
    scriptPath: "build/worker.mjs",
    compatibilityDate: "2026-11-26",
    d1Databases: { DB: "siph-local-test" },
    bindings: {
      RESEND_API_KEY: "test-only-runtime-secret",
      EMAIL_FROM: "sender@example.org",
      GOOGLE_ALERTS_FEEDS: JSON.stringify([
        "https://www.google.com/alerts/feeds/fixture/account",
      ]),
    },
    outboundService: async (req) => {
      if (req.url.startsWith("https://www.google.com/alerts/feeds/"))
        return new Response(
          '<feed><entry><title>SiPH คุณหมอบริการดี</title><link rel="alternate" href="https://www.google.com/url?url=https%3A%2F%2Fpantip.com%2Ftopic%2F123"/><content>โรงพยาบาลดี</content></entry></feed>',
        );
      if (req.url.startsWith("https://api.bsky.app/"))
        return Response.json({
          posts: [
            {
              uri: "at://did:plc:runtime/app.bsky.feed.post/abc123",
              record: {
                text: "ขอบคุณ SiPH คุณหมอดูแลดี",
                createdAt: new Date().toISOString(),
              },
            },
          ],
        });
      if (req.url.startsWith("https://api.resend.com/")) {
        deliveries.push(await req.json());
        return Response.json({ id: "accepted" });
      }
      return new Response(
        "<rss><channel><item><title>SiPH ขอบคุณ</title><link>https://example.org/news</link></item></channel></rss>",
      );
    },
  });
  try {
    const db = await mf.getD1Database("DB");
    const sql = await readFile(
      new URL("../db/migrations/0001_existing_schema.sql", import.meta.url),
      "utf8",
    );
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
    await db
      .prepare("INSERT INTO settings VALUES(1,?)")
      .bind(
        JSON.stringify({
          ...DEFAULT,
          bluesky_enabled: true,
          youtube_enabled: false,
          email_enabled: true,
          email_to: "recipient@example.org",
        }),
      )
      .run();
    await db
      .prepare("INSERT INTO auth(id,setup_hash,setup_expires) VALUES(1,?,?)")
      .bind(await hash("test-runtime-setup"), Date.now() + 60000)
      .run();
    let r = await mf.dispatchFetch("https://monitor.test/api/state");
    assert.equal(r.status, 401);
    r = await mf.dispatchFetch("https://monitor.test/auth/setup", {
      method: "POST",
      headers: {
        Origin: "https://monitor.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: "test-runtime-setup",
        password: "runtime-test-password",
      }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const cookie = r.headers.get("set-cookie").split(";")[0];
    r = await mf.dispatchFetch("https://monitor.test/api/scan", {
      method: "POST",
      headers: {
        Origin: "https://monitor.test",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: "{}",
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).added, 3);
    r = await mf.dispatchFetch("https://monitor.test/api/state", {
      headers: { Cookie: cookie },
    });
    const state = await r.json();
    assert.equal(state.stats.total, 3);
    assert.equal(state.google_alerts_setup.count, 1);
    assert.doesNotMatch(JSON.stringify(state), /\/alerts\/feeds\/fixture/);
    assert.equal(state.connections.email, true);
    assert.doesNotMatch(JSON.stringify(state), /test-only-runtime-secret/);
    const worker = await mf.getWorker();
    await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() });
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM runs").first()).n,
      1,
    );
    assert.equal(
      (await db.prepare("SELECT status FROM deliveries").first()).status,
      "sent",
    );
    assert.equal(deliveries.length, 3);
    assert.deepEqual(deliveries[0].to, ["recipient@example.org"]);
  } finally {
    await mf.dispose();
  }
});
