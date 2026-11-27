/** Public-source adapters. No scraping, credentials in URLs, or paid provider enrollment. */
const WEEK = 7 * 86400000;
export function relevantHospitalMention(text, keywords) {
  const normalized = String(text).toLowerCase();
  return keywords.some((keyword) => {
    const k = keyword.toLowerCase().trim();
    if (k !== "siph") return normalized.includes(k);
    return (
      /(?:^|[^a-z0-9_])siph(?=$|[^a-z0-9_])/i.test(text) &&
      /ศิริราช|โรงพยาบาล|รพ\.|หมอ|แพทย์|พยาบาล|ผู้ป่วย|คนไข้|รักษา|ผ่าตัด|สุขภาพ|บริการ|รอนาน|ประทับใจ|hospital|siriraj|doctor|patient|medical|healthcare|appointment|nurse|clinic/i.test(
        text,
      )
    );
  });
}
function recent(date, now) {
  const ms = Date.parse(date);
  return Number.isFinite(ms) && ms >= now - WEEK && ms <= now + 86400000;
}
export function blueskyRecords(data, keywords, now = Date.now()) {
  if (!data || !Array.isArray(data.posts))
    throw Error("Bluesky ส่งรูปแบบข้อมูลไม่ถูกต้อง");
  return data.posts.slice(0, 100).flatMap((post) => {
    const text = post?.record?.text,
      created = post?.record?.createdAt || post?.indexedAt;
    const match =
      typeof post?.uri === "string" &&
      post.uri.match(
        /^at:\/\/(did:[a-z0-9]+:[a-zA-Z0-9._:%-]+)\/app\.bsky\.feed\.post\/([a-zA-Z0-9]+)$/,
      );
    if (
      typeof text !== "string" ||
      !match ||
      !recent(created, now) ||
      !relevantHospitalMention(text, keywords)
    )
      return [];
    return [
      {
        title: text.slice(0, 240),
        text: text.slice(0, 12000),
        url:
          "https://bsky.app/profile/" +
          encodeURIComponent(match[1]) +
          "/post/" +
          match[2],
        source: "Bluesky",
        published: created,
        guid: post.uri,
      },
    ];
  });
}
export function youtubeRecords(data, keywords, now = Date.now()) {
  if (!data || !Array.isArray(data.items))
    throw Error("YouTube ส่งรูปแบบข้อมูลไม่ถูกต้อง");
  return data.items.slice(0, 50).flatMap((item) => {
    const id = item?.id?.videoId,
      s = item?.snippet;
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]{11}$/.test(id) ||
      typeof s?.title !== "string"
    )
      return [];
    const text =
      s.title + " " + (typeof s.description === "string" ? s.description : "");
    if (!recent(s.publishedAt, now) || !relevantHospitalMention(text, keywords))
      return [];
    return [
      {
        title: s.title.slice(0, 3000),
        text: text.slice(0, 12000),
        url: "https://www.youtube.com/watch?v=" + id,
        source: "YouTube",
        published: s.publishedAt,
        guid: "youtube:" + id,
      },
    ];
  });
}
export async function collectPublicSocial(
  config,
  keys,
  readJSON,
  now = Date.now(),
) {
  const result = { records: [], errors: [], success: 0 };
  if (config.bluesky_enabled) {
    try {
      const u = new URL("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts");
      u.search = new URLSearchParams({
        q: config.keywords
          .map((k) => '"' + k.replaceAll('"', "") + '"')
          .join(" OR "),
        sort: "latest",
        limit: "100",
        since: new Date(now - WEEK).toISOString(),
      });
      result.records.push(
        ...blueskyRecords(await readJSON(u.href), config.keywords, now),
      );
      result.success++;
    } catch (e) {
      result.errors.push("Bluesky: " + safeSourceError(e));
    }
  }
  if (config.youtube_enabled && keys.youtube_api_key) {
    try {
      const u = new URL("https://www.googleapis.com/youtube/v3/search");
      u.search = new URLSearchParams({
        part: "snippet",
        type: "video",
        q: config.keywords
          .map((k) => '"' + k.replaceAll('"', "") + '"')
          .join("|"),
        order: "date",
        maxResults: "50",
        publishedAfter: new Date(now - WEEK).toISOString(),
      });
      result.records.push(
        ...youtubeRecords(
          await readJSON(u.href, { "X-Goog-Api-Key": keys.youtube_api_key }),
          config.keywords,
          now,
        ),
      );
      result.success++;
    } catch (e) {
      result.errors.push("YouTube: " + safeSourceError(e));
    }
  }
  return result;
}
function safeSourceError(error) {
  const status = String(error?.message || "").match(/HTTP \d{3}/)?.[0];
  return status || "อ่านข้อมูลไม่สำเร็จ กรุณาตรวจแหล่งข้อมูลและโควตา";
}
