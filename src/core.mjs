import { XMLParser } from "fast-xml-parser";
export const DEFAULT = {
  bluesky_enabled: true,
  youtube_enabled: true,
  keywords: [
    "ศิริราช ปิยมหาราชการุณย์",
    "ศิริราชปิยมหาราชการุณย์",
    "SiPH",
    "Siriraj Piyamaharajkarun",
  ],
  holidays: [],
  email_to: "",
  line_to: "",
  email_enabled: false,
  line_enabled: false,
  alert_sentiments: ["negative", "positive", "neutral"],
  paused: false,
};
// Transparent lexicon triage, not a claim of clinical accuracy or an AI model.
export function classify(text) {
  const t = String(text).toLowerCase();
  const negative = [
    "ร้องเรียน",
    "ผิดหวัง",
    "รอนาน",
    "บริการแย่",
    "แพง",
    "ไม่พอใจ",
    "ล่าช้า",
    "ผิดพลาด",
    "complaint",
    "poor",
    "disappointed",
    "ไม่ประทับใจ",
    "not good",
  ];
  const positive = [
    "ขอบคุณ",
    "ประทับใจ",
    "ชื่นชม",
    "ดูแลดี",
    "ยอดเยี่ยม",
    "รางวัล",
    "ดีมาก",
    "อบอุ่น",
    "excellent",
    "thank",
    "award",
    "ไม่แพง",
    "ไม่ต้องรอนาน",
    "not bad",
  ];
  let neg = negative.filter((w) => t.includes(w)),
    pos = positive.filter((w) => t.includes(w));
  if (t.includes("ไม่แพง")) neg = neg.filter((w) => w !== "แพง");
  if (t.includes("ไม่ต้องรอนาน")) neg = neg.filter((w) => w !== "รอนาน");
  if (t.includes("ไม่ประทับใจ")) pos = pos.filter((w) => w !== "ประทับใจ");
  if (neg.length && pos.length)
    return [
      "neutral",
      "พบทั้งคำเชิงบวกและลบ ต้องตรวจบริบท: " + [...neg, ...pos].join(", "),
    ];
  if (neg.length) return ["negative", "พบคำที่ควรตรวจสอบ: " + neg.join(", ")];
  if (pos.length) return ["positive", "พบคำเชิงบวก: " + pos.join(", ")];
  return ["neutral", "ยังไม่พบคำชี้บ่งชัดเจน — ควรอ่านบริบทต้นฉบับ"];
}
function daySlots(day, holidays) {
  const date = new Date(day),
    key = date.toISOString().slice(0, 10),
    office = date.getUTCDay() % 6 !== 0 && !holidays.includes(key);
  return (
    office
      ? [0, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20]
      : [0, 4, 8, 12, 16, 20]
  ).map((h) => day + h * 3600000 + 1800000 - 7 * 3600000);
}
export function schedule(now = Date.now(), holidays = []) {
  const local = new Date(now + 7 * 3600000);
  const day = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const slots = [-1, 0, 1].flatMap((d) =>
    daySlots(day + d * 86400000, holidays),
  );
  return {
    slot: Math.max(...slots.filter((x) => x <= now)),
    next: Math.min(...slots.filter((x) => x > now)),
  };
}
export const hex = (b) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join(
    "",
  );
export const hash = async (s) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export function parseRSS(xml, defaultSource = "Google News") {
  if (/<!DOCTYPE/i.test(xml)) throw Error("ไม่รองรับ DTD ใน RSS");
  const parser = new XMLParser({
    ignoreAttributes: true,
    processEntities: true,
    htmlEntities: true,
    trimValues: true,
  });
  const root = parser.parse(xml);
  if (!root?.rss || !Object.hasOwn(root.rss, "channel"))
    throw Error("รูปแบบ RSS ไม่ถูกต้อง");
  let items = root.rss.channel.item || [];
  return (Array.isArray(items) ? items : [items])
    .slice(0, 100)
    .filter((a) => typeof a.title === "string" && typeof a.link === "string")
    .map((a) => {
      let url;
      try {
        url = new URL(a.link);
        if (
          /(^|\.)bing\.com$/.test(url.hostname) &&
          url.pathname === "/news/apiclick.aspx" &&
          url.searchParams.get("url")
        )
          url = new URL(url.searchParams.get("url"));
      } catch {
        return null;
      }
      if (url.protocol !== "https:") return null;
      return {
        title: a.title,
        url: url.href,
        source: String(a.source || a["News:Source"] || defaultSource),
        published: String(a.pubDate || ""),
        guid: typeof a.guid === "string" ? a.guid : url.href,
        text:
          a.title + " " + String(a.description || "").replace(/<[^>]*>/g, " "),
      };
    })
    .filter(Boolean);
}

export function validateSettings(old, b) {
  const cfg = { ...DEFAULT, ...old };
  if (!b || Array.isArray(b) || typeof b !== "object")
    throw Error("ข้อมูลไม่ถูกต้อง");
  for (const k of [
    "email_enabled",
    "line_enabled",
    "paused",
    "bluesky_enabled",
    "youtube_enabled",
  ])
    if (k in b) {
      if (typeof b[k] !== "boolean") throw Error("ค่าการเปิดปิดไม่ถูกต้อง");
      cfg[k] = b[k];
    }
  for (const k of ["email_to", "line_to"])
    if (k in b) {
      if (typeof b[k] !== "string" || b[k].length > 500)
        throw Error("ผู้รับไม่ถูกต้อง");
      cfg[k] = b[k].trim();
    }
  if (cfg.email_to && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(cfg.email_to))
    throw Error("รูปแบบอีเมลไม่ถูกต้อง");
  if (cfg.line_to && !/^[UCR][a-f0-9]{32}$/i.test(cfg.line_to))
    throw Error("LINE ID ต้องขึ้นต้นด้วย U, C หรือ R ตามด้วยอักขระ 32 ตัว");
  if ("keywords" in b) {
    if (
      !Array.isArray(b.keywords) ||
      !b.keywords.length ||
      b.keywords.length > 20 ||
      b.keywords.some(
        (k) => typeof k !== "string" || !k.trim() || k.length > 100,
      )
    )
      throw Error("ระบุคำค้น 1–20 คำ");
    cfg.keywords = b.keywords.map((k) => k.trim());
  }
  if ("holidays" in b) {
    if (
      !Array.isArray(b.holidays) ||
      b.holidays.length > 400 ||
      b.holidays.some(
        (d) =>
          typeof d !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
          Number.isNaN(Date.parse(d)) ||
          new Date(d).toISOString().slice(0, 10) !== d,
      )
    )
      throw Error("รูปแบบวันหยุดต้องเป็น YYYY-MM-DD");
    cfg.holidays = b.holidays;
  }
  if ("alert_sentiments" in b) {
    if (
      !Array.isArray(b.alert_sentiments) ||
      b.alert_sentiments.some(
        (x) => !["positive", "negative", "neutral"].includes(x),
      )
    )
      throw Error("หมวดข่าวไม่ถูกต้อง");
    cfg.alert_sentiments = b.alert_sentiments;
  }
  return cfg;
}
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
