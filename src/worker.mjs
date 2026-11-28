import {
  collectAlerts,
  alertFeedConfig,
  excludedURL,
  mentionSearchQueries,
} from "./google-alerts.mjs";
import { collectPublicSocial } from "./public-social.mjs";
import { credentials, sourceURL } from "./integrations.mjs";
import {
  DEFAULT,
  classify,
  schedule,
  hash,
  hex,
  parseRSS,
  validateSettings,
  csvCell,
} from "./core.mjs";
import { ASSETS, LOGIN } from "./generated-assets.mjs";
class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const enc = new TextEncoder(),
  stamp = () => new Date().toISOString();
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
function response(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": CSP,
      ...headers,
    },
  });
}
const json = (body, status = 200, headers = {}) =>
  response(JSON.stringify(body), status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
async function safeEqual(a, b) {
  if (!a || !b) return false;
  const args = { name: "HMAC", hash: "SHA-256" };
  const ka = await crypto.subtle.importKey("raw", enc.encode(a), args, false, [
    "sign",
  ]);
  const kb = await crypto.subtle.importKey("raw", enc.encode(b), args, false, [
    "verify",
  ]);
  const msg = enc.encode("siph-auth-compare");
  return crypto.subtle.verify(
    "HMAC",
    kb,
    await crypto.subtle.sign("HMAC", ka, msg),
    msg,
  );
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: enc.encode(salt),
        iterations: 100000,
        hash: "SHA-256",
      },
      key,
      256,
    ),
  );
}
async function cfg(env) {
  const r = await env.DB.prepare(
    "SELECT data FROM settings WHERE id=1",
  ).first();
  return { ...DEFAULT, ...JSON.parse(r?.data || "{}") };
}
async function body(req) {
  if (!req.headers.get("Content-Type")?.startsWith("application/json"))
    throw new RequestError("กรุณาส่งข้อมูลแบบ JSON");
  const raw = await boundedText(req, 20000);
  let b;
  try {
    b = JSON.parse(raw);
  } catch {
    throw new RequestError("ข้อมูล JSON ไม่ถูกต้อง");
  }
  if (!b || typeof b !== "object" || Array.isArray(b))
    throw new RequestError("ข้อมูลต้องเป็น JSON object");
  return b;
}
async function boundedText(source, max = 3000000) {
  const reader = source.body?.getReader();
  if (!reader) return "";
  let size = 0,
    parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new RequestError("ข้อมูลเกินขนาดที่อนุญาต", 413);
      parts.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.length;
  }
  return new TextDecoder().decode(merged);
}
async function getURL(url, headers = {}) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20000),
    redirect: "manual",
  });
  if (!res.ok) throw Error("แหล่งข้อมูลตอบกลับ HTTP " + res.status);
  return boundedText(res);
}
async function session(req, env) {
  const token = (req.headers.get("Cookie") || "").match(
    /(?:^|;\s*)__Host-siph=([a-f0-9]{64})(?:;|$)/,
  )?.[1];
  if (!token) return false;
  return !!(await env.DB.prepare(
    "SELECT 1 FROM sessions WHERE token_hash=? AND expires>?",
  )
    .bind(await hash(token), Date.now())
    .first());
}
async function newSession(env) {
  const token = random();
  await env.DB.prepare("INSERT INTO sessions VALUES(?,?)")
    .bind(await hash(token), Date.now() + 12 * 3600000)
    .run();
  return (
    "__Host-siph=" +
    token +
    "; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict"
  );
}
async function rateLimit(req, env) {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const n = Date.now(),
    bucket = await hash(ip + ":" + Math.floor(n / 600000));
  const row = await env.DB.prepare(
    "INSERT INTO auth_attempts(bucket,count,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(bucket, n + 1200000)
    .first();
  return row.count > 10;
}
async function acquire(env, name, ttl = 240000) {
  const owner = crypto.randomUUID();
  const row = await env.DB.prepare(
    "INSERT INTO locks(name,owner,expires) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires<? RETURNING owner",
  )
    .bind(name, owner, Date.now() + ttl, Date.now())
    .first();
  return row?.owner === owner ? owner : null;
}
async function release(env, name, owner) {
  await env.DB.prepare("DELETE FROM locks WHERE name=? AND owner=?")
    .bind(name, owner)
    .run();
}
async function collect(config, keys) {
  const query =
    "(" +
    config.keywords.map((k) => '"' + k.replaceAll('"', "") + '"').join(" OR ") +
    ") when:7d";
  const newsURL =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=th&gl=TH&ceid=TH:th";
  let records = [],
    errors = [],
    success = 0;
  try {
    records = parseRSS(
      await getURL(newsURL, {
        "User-Agent": "Mozilla/5.0 (compatible; SiPHPulse/1.0)",
      }),
    );
    success++;
  } catch (e) {
    errors.push("Google News: " + e.message);
    try {
      const bing =
        "https://www.bing.com/news/search?q=" +
        encodeURIComponent(
          config.keywords
            .map((k) => '\"' + k.replaceAll('\"', "") + '\"')
            .join(" OR "),
        ) +
        "&format=rss";
      records = parseRSS(
        await getURL(bing, {
          "User-Agent": "Mozilla/5.0 (compatible; SiPHPulse/1.0)",
        }),
        "Bing News",
      ).filter(
        (a) =>
          !a.published ||
          !Number.isFinite(Date.parse(a.published)) ||
          Date.parse(a.published) >= Date.now() - 7 * 86400000,
      );
      success++;
    } catch (f) {
      errors.push("Bing News: " + f.message);
    }
  }
  if (keys.social_feed_url) {
    try {
      let data;
      const raw = await getURL(sourceURL(keys.social_feed_url), {
        Authorization: "Bearer " + (keys.social_feed_token || ""),
      });
      try {
        data = JSON.parse(raw);
      } catch {
        throw Error("Social API ส่ง JSON ที่อ่านไม่ได้");
      }
      if (!Array.isArray(data)) data = data?.data;
      if (!Array.isArray(data))
        throw Error("API ต้องส่ง JSON array หรือ {data:[]}");
      for (const a of data.slice(0, 500)) {
        if (!a || typeof a !== "object") continue;
        const text = typeof a.text === "string" ? a.text.slice(0, 12000) : "";
        const title =
          typeof a.title === "string"
            ? a.title.slice(0, 3000)
            : text.slice(0, 240);
        if (
          !title ||
          typeof a.url !== "string" ||
          !config.keywords.some((k) =>
            (title + " " + text).toLowerCase().includes(k.toLowerCase()),
          )
        )
          continue;
        let link;
        try {
          link = new URL(a.url);
          if (link.protocol !== "https:" || link.username || link.password)
            continue;
        } catch {
          continue;
        }
        link.hash = "";
        records.push({
          title,
          url: link.href,
          source: String(a.source || a.platform || "Social API").slice(0, 200),
          published: String(a.published || ""),
          guid: link.href,
          text: title + " " + text,
        });
      }
      success++;
    } catch (e) {
      errors.push("Social API: " + e.message);
    }
  }
  const publicResult = await collectPublicSocial(
    config,
    keys,
    async (url, headers) => {
      const raw = await getURL(url, headers);
      try {
        return JSON.parse(raw);
      } catch {
        throw Error("API ส่ง JSON ที่อ่านไม่ได้");
      }
    },
  );
  records.push(...publicResult.records);
  errors.push(...publicResult.errors);
  success += publicResult.success;
  const alerts = await collectAlerts(config, keys.google_alerts_feeds, (url) =>
    getURL(url),
  );
  records.push(...alerts.records);
  errors.push(...alerts.errors);
  success += alerts.success;
  records = records.filter(
    (record) => !excludedURL(record.url, config.excluded_urls),
  );
  return { records, errors, success };
}
async function scan(env, { scheduled = false } = {}) {
  const lock = await acquire(env, "scan");
  if (!lock) return { busy: true };
  const started = stamp(),
    runID = crypto.randomUUID();
  let added = 0;
  try {
    const config = await cfg(env),
      slot = schedule(Date.now(), config.holidays).slot;
    if (scheduled) {
      if (config.paused) return { paused: true };
      const last = await env.DB.prepare(
        "SELECT MAX(slot) AS slot FROM runs",
      ).first();
      if (last.slot >= slot) return { skipped: true };
    } else {
      const last = await env.DB.prepare(
        "SELECT started,status FROM runs ORDER BY id DESC LIMIT 1",
      ).first();
      if (
        last &&
        last.status !== "error" &&
        Date.now() - Date.parse(last.started) < 60000
      )
        return { busy: true };
    }
    const keys = await credentials(env),
      result = await collect(config, keys);
    for (let i = 0; i < result.records.length; i += 10) {
      const chunk = result.records.slice(i, i + 10),
        statements = [];
      for (const a of chunk) {
        const id = await hash(a.guid),
          [sentiment, reason] = classify(a.text);
        statements.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO articles(id,title,url,source,published,found,sentiment,reason,run_id) VALUES(?,?,?,?,?,?,?,?,?)",
          ).bind(
            id,
            a.title,
            a.url,
            a.source,
            a.published,
            started,
            sentiment,
            a.discovery === "google-alerts"
              ? reason + " · ประเมินจากข้อความย่อ Google Alerts กรุณาอ่านโพสต์ต้นฉบับ"
              : reason,
            runID,
          ),
        );
        for (const channel of ["email", "line"])
          if (
            config[channel + "_enabled"] &&
            config.alert_sentiments.includes(sentiment)
          ) {
            statements.push(
              env.DB.prepare(
                "INSERT OR IGNORE INTO deliveries(article_id,channel,next_try,retry_key) SELECT id,?,?,? FROM articles WHERE id=? AND run_id=?",
              ).bind(channel, Date.now(), crypto.randomUUID(), id, runID),
            );
          }
      }
      await env.DB.batch(statements);
    }

    // Count records by this scan's unique marker rather than relying on adapter internals.
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM articles WHERE run_id=?",
    )
      .bind(runID)
      .first();
    added = count.count;
    const status = !result.success
      ? "error"
      : result.errors.length
        ? "partial"
        : "success";
    await env.DB.prepare(
      "INSERT INTO runs(started,finished,added,status,message,slot) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        started,
        stamp(),
        added,
        status,
        result.errors.join(" | ") ||
          "Google News / Bing / public social / configured provider API",
        slot,
      )
      .run();
    return result.success
      ? { added, partial: result.errors.length > 0 }
      : { error: "ตรวจข่าวไม่สำเร็จ กรุณาดูประวัติการทำงาน" };
  } catch (e) {
    await env.DB.prepare(
      "INSERT INTO runs(started,finished,added,status,message,slot) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        started,
        stamp(),
        added,
        "error",
        String(e.message).slice(0, 300),
        schedule(Date.now(), (await cfg(env)).holidays).slot,
      )
      .run();
    console.error(JSON.stringify({ event: "scan_error", type: e.name }));
    return { error: "ตรวจข่าวไม่สำเร็จ กรุณาดูประวัติการทำงาน" };
  } finally {
    await release(env, "scan", lock);
  }
}
async function sendDelivery(row, config, keys) {
  const names = { positive: "เชิงบวก", negative: "เชิงลบ", neutral: "เป็นกลาง" };
  const text = `SiPH • ${names[row.sentiment]}\n${row.title}\n${row.url}\nการจัดหมวดหมู่เบื้องต้น กรุณาตรวจสอบบริบท`;
  let res;
  if (row.channel === "email") {
    if (!keys.email_api_key || !keys.email_from || !config.email_to)
      throw Error("ยังไม่ตั้งค่า Resend / ผู้ส่ง / ผู้รับ");
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + keys.email_api_key,
        "Idempotency-Key": "siph-" + row.retry_key,
      },
      body: JSON.stringify({
        from: keys.email_from,
        to: [config.email_to],
        subject: "[SiPH Monitor] ข่าวใหม่ที่กล่าวถึง SiPH",
        text,
      }),
    });
  } else {
    if (!keys.line_token || !config.line_to)
      throw Error("ยังไม่ตั้งค่า LINE token / ผู้รับ");
    res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + keys.line_token,
        "X-Line-Retry-Key": row.retry_key,
      },
      body: JSON.stringify({
        to: config.line_to,
        messages: [{ type: "text", text: text.slice(0, 4900) }],
      }),
    });
    if (res.status === 409 && res.headers.has("x-line-accepted-request-id")) {
      await res.body?.cancel();
      return;
    }
  }
  const code = res.status;
  await res.body?.cancel();
  if (!res.ok) throw Error(row.channel + " ตอบกลับ HTTP " + code);
}
async function deliver(env) {
  const lock = await acquire(env, "delivery");
  if (!lock) return;
  try {
    const config = await cfg(env),
      keys = await credentials(env);
    const rows = (
      await env.DB.prepare(
        "SELECT d.*,a.title,a.url,a.sentiment FROM deliveries d JOIN articles a ON a.id=d.article_id WHERE d.status='pending' AND d.next_try<=? AND ((d.channel='email' AND ?=1) OR (d.channel='line' AND ?=1)) ORDER BY d.id LIMIT 5",
      )
        .bind(
          Date.now(),
          Number(config.email_enabled),
          Number(config.line_enabled),
        )
        .all()
    ).results;
    for (const row of rows) {
      if (!config[row.channel + "_enabled"]) continue;
      try {
        await sendDelivery(row, config, keys);
        await env.DB.prepare(
          "UPDATE deliveries SET status='sent',attempts=attempts+1,error=NULL WHERE id=?",
        )
          .bind(row.id)
          .run();
      } catch (e) {
        const attempts = row.attempts + 1;
        await env.DB.prepare(
          "UPDATE deliveries SET status=?,attempts=?,next_try=?,error=? WHERE id=?",
        )
          .bind(
            attempts >= 5 ? "failed" : "pending",
            attempts,
            Date.now() + Math.min(240, 5 * 2 ** attempts) * 60000,
            String(e.message).slice(0, 250),
            row.id,
          )
          .run();
      }
    }
  } finally {
    await release(env, "delivery", lock);
  }
}
async function expireYouTube(env, now = Date.now()) {
  const cutoff = new Date(now - 29 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM deliveries WHERE article_id IN (SELECT id FROM articles WHERE source='YouTube' AND found<?)",
    ).bind(cutoff),
    env.DB.prepare(
      "DELETE FROM articles WHERE source='YouTube' AND found<?",
    ).bind(cutoff),
  ]);
}
async function state(env) {
  const config = await cfg(env),
    keys = credentials(env),
    r = await env.DB.batch([
      env.DB.prepare("SELECT * FROM articles ORDER BY found DESC LIMIT 1000"),
      env.DB.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 30"),
      env.DB.prepare(
        "SELECT id,channel,status,attempts,error FROM deliveries ORDER BY id DESC LIMIT 50",
      ),
      env.DB.prepare(
        "SELECT COUNT(*) AS total,COALESCE(SUM(sentiment='positive'),0) AS positive,COALESCE(SUM(sentiment='negative'),0) AS negative,COALESCE(SUM(sentiment='neutral'),0) AS neutral FROM articles",
      ),
    ]);
  return {
    articles: r[0].results,
    runs: r[1].results,
    deliveries: r[2].results,
    stats: r[3].results[0],
    settings: config,
    next: new Date(schedule(Date.now(), config.holidays).next).toISOString(),
    connections: {
      news: true,
      google_alerts:
        config.google_alerts_enabled &&
        alertFeedConfig(keys.google_alerts_feeds).status === "ready",
      social: !!keys.social_feed_url,
      bluesky: config.bluesky_enabled,
      youtube: config.youtube_enabled && !!keys.youtube_api_key,
      email: !!keys.email_api_key && !!keys.email_from,
      line: !!keys.line_token,
    },
    google_alerts_setup: {
      status: alertFeedConfig(keys.google_alerts_feeds).status,
      count: alertFeedConfig(keys.google_alerts_feeds).urls.length,
    },
    mention_queries: mentionSearchQueries(config.keywords),
    limits: { articles: 1000, export: 10000 },
    runtime: "cloudflare",
  };
}
async function handle(req, env, ctx) {
  const url = new URL(req.url),
    path = url.pathname;
  if (req.method === "POST") {
    if (
      req.headers.get("Origin") !== url.origin ||
      req.headers.get("Sec-Fetch-Site") === "cross-site"
    )
      return json({ error: "Origin rejected" }, 403);
  }
  if (path === "/login.js" && req.method === "GET")
    return response(ASSETS["/login.js"], 200, {
      "Content-Type": "text/javascript; charset=utf-8",
    });
  if (
    (path === "/" || path === "/login") &&
    req.method === "GET" &&
    !(await session(req, env))
  )
    return response(LOGIN, 200, { "Content-Type": "text/html; charset=utf-8" });
  if (path === "/auth/setup" || path === "/auth/login") {
    if (req.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (await rateLimit(req, env))
      return json({ error: "ลองเข้าสู่ระบบหลายครั้ง กรุณารอ 10 นาที" }, 429);
    const b = await body(req);
    if (typeof b.password !== "string" || b.password.length > 256)
      return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    const a = await env.DB.prepare("SELECT * FROM auth WHERE id=1").first();
    if (!a) return json({ error: "ยังไม่ได้เริ่มต้นฐานข้อมูล กรุณาดูคู่มือติดตั้ง" }, 503);
    if (path === "/auth/setup") {
      if (b.password.length < 12)
        return json({ error: "ใช้รหัสผ่านอย่างน้อย 12 ตัวอักษร" }, 400);
      if (
        a.password_hash ||
        !a.setup_hash ||
        Date.now() > a.setup_expires ||
        typeof b.token !== "string" ||
        !(await safeEqual(a.setup_hash, await hash(b.token)))
      )
        return json({ error: "ลิงก์ตั้งค่าไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว" }, 403);
      const salt = random(),
        ph = await passwordHash(b.password, salt);
      const r = await env.DB.prepare(
        "UPDATE auth SET salt=?,password_hash=?,setup_hash=NULL,setup_expires=NULL WHERE id=1 AND password_hash IS NULL AND setup_hash=?",
      )
        .bind(salt, ph, a.setup_hash)
        .run();
      if (!r.meta.changes) return json({ error: "ลิงก์ถูกใช้แล้ว" }, 409);
    } else {
      const ph = await passwordHash(
        b.password,
        a.salt || "siph-not-initialized",
      );
      if (!a.password_hash || !(await safeEqual(a.password_hash, ph)))
        return json({ error: "รหัสผ่านไม่ถูกต้อง หรือยังไม่ได้ตั้งค่าครั้งแรก" }, 401);
    }
    return json({ ok: true }, 200, { "Set-Cookie": await newSession(env) });
  }
  if (!(await session(req, env)))
    return path.startsWith("/api/")
      ? json({ error: "กรุณาเข้าสู่ระบบ" }, 401)
      : response("", 302, { Location: "/login" });
  if (path === "/auth/logout" && req.method === "POST") {
    const token = (req.headers.get("Cookie") || "").match(
      /__Host-siph=([a-f0-9]{64})/,
    )?.[1];
    if (token)
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(await hash(token))
        .run();
    return json({ ok: true }, 200, {
      "Set-Cookie":
        "__Host-siph=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
    });
  }
  if (path === "/api/state" && req.method === "GET")
    return json(await state(env));
  if (path === "/api/scan" && req.method === "POST") {
    await body(req);
    const r = await scan(env);
    return json(r);
  }
  if (path === "/api/settings" && req.method === "POST") {
    const previous = await cfg(env),
      data = await body(req);
    let config;
    try {
      config = validateSettings(previous, data);
    } catch (e) {
      return json({ error: e.message }, 400);
    }
    await env.DB.prepare("UPDATE settings SET data=? WHERE id=1")
      .bind(JSON.stringify(config))
      .run();
    return json({ saved: true });
  }
  if (path === "/api/integrations")
    return json(
      { error: "ตั้งค่า API keys ผ่าน Cloudflare Workers Secrets เท่านั้น" },
      405,
    );
  if (path === "/api/article" && req.method === "POST") {
    const b = await body(req);
    if (
      !["new", "reviewing", "done"].includes(b.status) ||
      !["positive", "negative", "neutral"].includes(b.sentiment) ||
      typeof b.id !== "string"
    )
      return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    await env.DB.prepare("UPDATE articles SET status=?,sentiment=? WHERE id=?")
      .bind(b.status, b.sentiment, b.id)
      .run();
    return json({ saved: true });
  }
  if (path === "/api/retry" && req.method === "POST") {
    await body(req);
    await env.DB.prepare(
      "UPDATE deliveries SET status='pending',attempts=0,next_try=? WHERE status='failed'",
    )
      .bind(Date.now())
      .run();
    return json({ saved: true });
  }
  if (path === "/api/export" && req.method === "GET") {
    const rows = (
      await env.DB.prepare(
        "SELECT title,source,sentiment,status,published,url FROM articles ORDER BY found DESC LIMIT 10000",
      ).all()
    ).results;
    const lines = [
      ["หัวข้อ", "แหล่งข่าว", "ทิศทาง", "สถานะ", "เผยแพร่", "ลิงก์"],
      ...rows.map((r) => [
        r.title,
        r.source,
        r.sentiment,
        r.status,
        r.published,
        r.url,
      ]),
    ];
    return response(
      "\ufeff" + lines.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      200,
      {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="siph-news.csv"',
      },
    );
  }
  if (
    req.method === "GET" &&
    (path === "/" || path === "/index.html" || path in ASSETS)
  ) {
    const filename = path === "/" ? "/index.html" : path;
    const mime = filename.endsWith(".css")
      ? "text/css"
      : filename.endsWith(".js")
        ? "text/javascript"
        : "text/html";
    return response(ASSETS[filename], 200, {
      "Content-Type": mime + "; charset=utf-8",
    });
  }
  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      console.error(JSON.stringify({ event: "request_error", type: e.name }));
      return json(
        {
          error:
            e instanceof RequestError
              ? e.message
              : "ระบบทำงานไม่สำเร็จ กรุณาติดต่อผู้ดูแล",
        },
        e instanceof RequestError ? e.status : 500,
      );
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const result = await scan(env, { scheduled: true });
        await expireYouTube(env);
        await deliver(env);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(
            Date.now(),
          ),
          env.DB.prepare("DELETE FROM auth_attempts WHERE expires<?").bind(
            Date.now(),
          ),
        ]);
        console.log(JSON.stringify({ event: "scheduled", ...result }));
      })(),
    );
  },
};
export {
  passwordHash,
  safeEqual,
  scan,
  deliver,
  collect,
  credentials,
  expireYouTube,
};
