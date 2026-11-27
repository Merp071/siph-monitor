## Behavior

Add free public-source collectors to SiPH monitoring without purchasing a Social Listening subscription:

- Bluesky public search works without a key, is enabled by default, and can be disabled in the dashboard. AT URI deduplicates posts; a hospital-context filter rejects technology uses of “SiPh”.
- Optional YouTube public-video search only runs when YOUTUBE_API_KEY is supplied through Cloudflare Secrets and the source toggle is enabled. The key is sent in a header and never exposed by the dashboard or stored in Git/D1. No Google project, billing enrollment or quota purchase is performed.
- Each source has independent failures; working RSS/provider sources still ingest data. Both reuse the existing hourly/4-hour schedule, sentiment triage and durable notification outbox.
- The dashboard explicitly identifies supported public sources and platforms that remain unconnected.

No schema migration or changes to existing credentials/authentication. Existing settings inherit the two new preferences. Scheduled cleanup deletes only YouTube metadata older than 29 days and its related delivery rows; other sources and auth are preserved.

## Validation

- 24 application tests, 6 public-source adapter tests and 1 real Workers-runtime/D1 test passed (31 total).
- Runtime test covers RSS + Bluesky ingestion and scheduled outbox delivery with mocked providers.
- Secret scan and build passed; no real API keys added.
- Live unauthenticated Bluesky search returned HTTP 200 from the development environment. The current combined hospital query returned zero results in the seven-day window; no synthetic mentions are inserted.
- Live YouTube calls remain unverified until an organization-owned API key is supplied.

## Limits and rollout

Review before deployment. Default search limits: one page per scan, up to 100 Bluesky posts and 50 YouTube videos, seven-day lookback. No completeness guarantee and no audio/transcript/all-comments ingestion. Facebook, Instagram, TikTok, X and Pantip are not directly connected by this PR. See docs/FREE_SOURCES.md for setup, quota and retention details.
