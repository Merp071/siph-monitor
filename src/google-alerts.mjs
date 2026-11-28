import { XMLParser } from "fast-xml-parser";
import { relevantHospitalMention } from "./public-social.mjs";
const GOOGLE_HOSTS = new Set(["google.com", "www.google.com"]);
export function alertFeedConfig(raw) {
  if (!raw) return { urls: [], status: "missing" };
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length || list.length > 10) throw Error();
    const urls = [
      ...new Set(
        list.map((value) => {
          if (typeof value !== "string" || value.length > 2048) throw Error();
          const u = new URL(value.trim());
          if (
            u.protocol !== "https:" ||
            !GOOGLE_HOSTS.has(u.hostname) ||
            u.port ||
            u.username ||
            u.password ||
            u.search ||
            u.hash ||
            !/^\/alerts\/feeds\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(
              u.pathname,
            )
          )
            throw Error();
          return u.href;
        }),
      ),
    ];
    return { urls, status: "ready" };
  } catch {
    return { urls: [], status: "invalid" };
  }
}
function plain(node) {
  const raw =
    typeof node === "string" || typeof node === "number"
      ? String(node)
      : typeof node?.["#text"] === "string"
        ? node["#text"]
        : "";
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function canonicalAlertURL(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    let u = new URL(value);
    for (
      let i = 0;
      i < 2 && GOOGLE_HOSTS.has(u.hostname) && u.pathname === "/url";
      i++
    ) {
      const target = u.searchParams.get("url") || u.searchParams.get("q");
      if (!target) return null;
      u = new URL(target);
    }
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      GOOGLE_HOSTS.has(u.hostname)
    )
      return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (
        /^utm_/i.test(key) ||
        ["fbclid", "gclid", "igshid"].includes(key.toLowerCase())
      )
        u.searchParams.delete(key);
    u.searchParams.sort();
    return u.href;
  } catch {
    return null;
  }
}
function normalizedHost(host) {
  return host.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "");
}
export function excludedURL(value, exclusions = []) {
  try {
    const target = new URL(value);
    return exclusions.some((entry) => {
      try {
        const rule = new URL(entry);
        if (normalizedHost(target.hostname) !== normalizedHost(rule.hostname))
          return false;
        const path = rule.pathname.replace(/\/+$/, "").toLowerCase(),
          actual = target.pathname.replace(/\/+$/, "").toLowerCase();
        if (path && actual !== path && !actual.startsWith(path + "/"))
          return false;
        for (const [k, v] of rule.searchParams)
          if (target.searchParams.get(k) !== v) return false;
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
export function alertSource(url) {
  const h = normalizedHost(new URL(url).hostname);
  const labels = {
    "facebook.com": "Facebook",
    "instagram.com": "Instagram",
    "tiktok.com": "TikTok",
    "x.com": "X",
    "twitter.com": "X",
    "pantip.com": "Pantip",
  };
  return (labels[h] || "Web") + " · Google Alerts";
}
export function parseAlertFeed(xml, keywords, exclusions = []) {
  if (typeof xml !== "string" || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("Invalid alert feed");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    processEntities: true,
    htmlEntities: true,
    trimValues: true,
  });
  let root;
  try {
    root = parser.parse(xml);
  } catch {
    throw Error("Invalid alert feed");
  }
  let entries,
    atom = false;
  if (root && Object.hasOwn(root, "feed")) {
    entries = root.feed?.entry || [];
    atom = true;
  } else if (root?.rss && Object.hasOwn(root.rss, "channel"))
    entries = root.rss.channel?.item || [];
  else throw Error("Invalid alert feed");
  return (Array.isArray(entries) ? entries : [entries])
    .slice(0, 100)
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      let link = item.link;
      if (atom) {
        const links = Array.isArray(link) ? link : [link];
        link =
          links.find((l) => l?.["@_rel"] === "alternate") ||
          links.find((l) => l?.["@_href"] && !l?.["@_rel"]);
        link = link?.["@_href"];
      } else link = plain(link);
      const url = canonicalAlertURL(link),
        title = plain(item.title).slice(0, 3000),
        snippet = plain(item.content || item.summary || item.description).slice(
          0,
          12000,
        ),
        text = title + " " + snippet;
      if (
        !url ||
        !title ||
        excludedURL(url, exclusions) ||
        !relevantHospitalMention(text, keywords)
      )
        return [];
      return [
        {
          title,
          url,
          source: alertSource(url),
          published: plain(item.published || item.updated || item.pubDate),
          guid: "google-alerts:" + url,
          text,
          discovery: "google-alerts",
        },
      ];
    });
}
export async function collectAlerts(config, rawFeeds, readFeed) {
  const feeds = alertFeedConfig(rawFeeds),
    result = { records: [], errors: [], success: 0 };
  if (!config.google_alerts_enabled || feeds.status === "missing")
    return result;
  if (feeds.status === "invalid") {
    result.errors.push(
      "Google Alerts: ตรวจรูปแบบ GOOGLE_ALERTS_FEEDS ใน Cloudflare Secrets",
    );
    return result;
  }
  // Bound concurrency and total ingestion independently of feed count.
  for (let i = 0; i < feeds.urls.length; i += 3) {
    const batch = await Promise.all(
      feeds.urls.slice(i, i + 3).map(async (url, j) => {
        try {
          return {
            records: parseAlertFeed(
              await readFeed(url),
              config.keywords,
              config.excluded_urls,
            ),
            ok: true,
          };
        } catch (e) {
          const status = String(e?.message || "").match(/HTTP \d{3}/)?.[0];
          return {
            error:
              "Google Alerts #" +
              (i + j + 1) +
              ": " +
              (status || "อ่าน feed ไม่สำเร็จ"),
          };
        }
      }),
    );
    for (const r of batch) {
      if (r.ok) {
        result.success++;
        result.records.push(...r.records);
      } else result.errors.push(r.error);
    }
  }
  result.records = [
    ...new Map(result.records.map((r) => [r.guid, r])).values(),
  ].slice(0, 100);
  return result;
}
export function mentionSearchQueries(keywords) {
  const terms = keywords
    .slice(0, 4)
    .map((k) => '"' + k.replaceAll('"', "") + '"')
    .join(" OR ");
  return [
    { platform: "Facebook", sites: "site:facebook.com" },
    { platform: "Instagram", sites: "site:instagram.com" },
    { platform: "TikTok", sites: "site:tiktok.com" },
    { platform: "X", sites: "(site:x.com OR site:twitter.com)" },
    { platform: "Pantip", sites: "site:pantip.com" },
  ].map((p) => ({ platform: p.platform, query: "(" + terms + ") " + p.sites }));
}
