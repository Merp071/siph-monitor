## Behavior

SiPH monitoring currently discovers news and public API results but cannot ingest Google-indexed mentions from user-created Alerts. Add an optional Google Alerts RSS/Atom importer and dashboard search shortcuts for Facebook, Instagram, TikTok, X and Pantip.

- Read at most 10 explicit HTTPS Google Alerts feed URLs from GOOGLE_ALERTS_FEEDS in Cloudflare Secrets. Do not expose feed URLs through state, stored articles, or source errors. Missing configuration makes no requests.
- Unwrap Google redirects, remove tracking, deduplicate target URLs across feeds, filter hospital context and label source platforms. Sentiment explicitly identifies its snippet-only evidence.
- Let administrators exclude actual official-account URLs from new collection across sources. Preserve historical data, authentication, schema, schedule and notification settings.
- Bound feed concurrency to three and aggregate imports to 100 records per scan; working sources continue after another feed fails. No automated Google Search scraping or direct platform API access is added.

## Validation

44 unit/application tests and one real Workers-runtime/D1 test passed (45 total), including Atom/RSS parsing, unsafe URL rejection, exclusions, sanitized failures, concurrency, deduplication, secret non-disclosure and scheduled notification outbox with mocked providers. Secret scan and production bundle build passed.

## Setup and limits

See docs/GOOGLE_ALERTS.md. The owner has not created an Alert yet, so no live feed is connected or verified. RSS must be available in the owner's Google account; email-only Alerts cannot be ingested. Google controls indexing and feed freshness; this cannot cover all social posts. Existing Email/LINE secrets and authorized recipients are still required for delivery. No keys, real feed URLs, paid subscriptions, or database migration are included.
