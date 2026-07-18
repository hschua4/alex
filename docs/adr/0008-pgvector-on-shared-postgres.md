# ADR-0008 — Swap shared Postgres to pgvector image, pin pg16

**Status:** Accepted

## Context

Alex's retrieval depends on the `vector` extension + HNSW index. The Skylab VPS
runs **one shared Postgres** (`postgres:16-alpine`) that four other apps
(resitly, odin, tradeai, kilo) sit on — and it has **no pgvector**. The dev
compose spec meanwhile named `pgvector/pgvector:pg17`, a latent major-version
mismatch with prod's PG16.

## Decision

- **Swap the shared image to `pgvector/pgvector:pg16`** — a drop-in superset of
  `postgres:16` (same PG16 binaries and on-disk format, existing `pgdata` volume
  and the four other databases keep working unchanged). Run `CREATE EXTENSION
  vector` **only in the `alex` database**; extensions are per-database, so the
  other apps never see it.
- **Pin the dev compose to `pgvector/pgvector:pg16`** to match prod exactly.
- Alex gets its own `alex` role + database via the shared `bootstrap.sh`.

## Alternatives considered

- **Separate pgvector Postgres just for Alex.** Rejected: contradicts "share the
  existing Postgres," adds a second DB to back up. Kept as the fallback if
  touching the shared image is ever off-limits.
- **Install pgvector into the running alpine image.** Rejected: fragile,
  non-standard.
- **Upgrade the shared DB to pg17** to match the original dev spec. Rejected:
  force-upgrading the DB four other apps depend on is far riskier than aligning
  dev down to pg16.

## Consequences

- One coordinated restart of the shared Postgres (brief downtime for all apps) —
  a one-time cost.
- Editing shared infra (the image tag + a bootstrap entry); other apps'
  behavior is unchanged.
- Dev/prod parity on the DB major version.
