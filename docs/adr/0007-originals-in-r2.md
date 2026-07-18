# ADR-0007 — Store original files in R2

**Status:** Accepted

## Context

Original uploaded files must live somewhere. The deploy target is the Skylab
VPS, where **disk fills fast** and the nightly backup (`skylab-backup.sh`) covers
**Postgres only** (`pg_dumpall | restic`) — not arbitrary Docker volumes. So a
local volume for originals would be an unprotected blind spot. Crucially, the
infra **already has R2/B2 credentials** (`RESTIC_REPOSITORY`,
`AWS_ACCESS_KEY_ID`) in `/srv/infra/.env` for the restic backups.

## Decision

Store originals **directly in R2** via the S3 API, reusing the existing
credentials and bucket (a distinct prefix from the restic repo). Keep originals
(don't discard after extraction) so documents can be re-indexed from source when
chunking is tuned.

## Alternatives considered

- **Local Docker volume + extend the backup script** to `restic backup` that
  path. Rejected: grows the constrained box's disk and means editing shared
  backup tooling; R2 already exists, so off-box is free of new dependencies.
- **Store extracted text only, discard originals.** Rejected: forfeits
  re-index-from-source (needed the first time chunk size is tuned —
  [ADR-0004](./0004-retrieval-design.md)) and any future PDF viewer.

## Consequences

- Originals are durable off-box by construction; no backup-script change, no
  local blind spot, VPS disk stays lean.
- The app is nearly stateless (Postgres + R2 hold all state), easing a future
  multi-instance split.
- Introduces an R2 dependency in the request path for uploads/downloads (already
  a trusted dependency in this infra).
