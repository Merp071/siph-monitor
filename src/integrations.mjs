/** Provider credentials are bound exclusively through Cloudflare Workers Secrets. */
export function credentials(env) {
  return {
    youtube_api_key: env.YOUTUBE_API_KEY || "",
    email_api_key: env.RESEND_API_KEY || "",
    email_from: env.EMAIL_FROM || "",
    line_token: env.LINE_CHANNEL_ACCESS_TOKEN || "",
    social_feed_url: env.SOCIAL_FEED_URL || "",
    social_feed_token: env.SOCIAL_FEED_TOKEN || "",
  };
}
export function sourceURL(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.hash)
      throw Error();
    return u.href;
  } catch {
    throw Error("Social API ต้องเป็น HTTPS ที่ไม่มี credentials หรือ fragment ใน URL");
  }
}
