## Problem and behavior

The repository is empty while an existing SiPH Worker/D1 deployment runs outside version control. This adds the reviewed source, Thai dashboard, RSS with Bing fallback, Social Listening adapter, sentiment triage, durable Email/LINE outbox, and the existing office-hours schedule to the repository without changing production.

Provider API keys are now read exclusively from Cloudflare Workers Secrets. The dashboard no longer accepts or stores credentials in D1. Existing tables, authentication and historical records are preserved; the baseline schema is idempotent and the legacy integrations table is retained for rollback.

Fixes include Thai negation/mixed sentiment, partial provider failures, notification backlog starvation, LINE conflict validation, accurate dashboard totals and generic unexpected API errors.

## Validation

- 22 passing unit/integration tests for scheduling, schema adoption, authentication, RSS/social, sentiment, provider notifications, retries, locks, totals and PR deployment gate.
- 1 passing Miniflare/workerd runtime test uses real local D1, password setup, authenticated scan, Secrets bindings and scheduled outbox delivery with mock providers.
- Build and publishable-file secret scan passed; npm audit reports zero vulnerabilities for all dependencies.
- Existing Worker source, D1 schema/counts, bindings and cron inspected read-only; no production migration, secret update, notification or deployment performed.

## Rollout

No auto-deploy workflow. Review and merge this PR, configure provider Secrets and recipients, then deploy from the exact merge commit using `npm run deploy -- --pr <number>`. The script verifies the merged PR and existing D1 binding and inherits existing Secrets. Preserve CREDENTIAL_KEY for legacy rollback. See docs/INSTALL.md for backups, setup and rollback.

Live Email/LINE and a vendor-specific social account require credentials and recipient/provider checks after review. Sentiment is transparent lexicon triage, not an AI model or a fact-checking system.
