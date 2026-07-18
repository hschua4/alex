# ADR-0006 — Async ingestion via pg-boss; idempotent delete-then-insert

**Status:** Accepted

## Context

Ingesting a large PDF (extract → chunk → embed in many batched calls → store)
takes tens of seconds and many embedding calls — it cannot block the upload
request. The prototype shows a document `status` lifecycle, confirming async
processing. Failure modes must not produce duplicate chunks or half-indexed
documents that pollute retrieval. The runtime is a **single** Node server with
Postgres already present, on a RAM-constrained VPS.

## Decision

- **Async via pg-boss** — jobs live in the same Postgres (no new infra), durable
  across restarts, retryable, concurrency-capped. The worker runs **in-process**
  with a hard concurrency cap so embedding work can't starve chat latency on the
  4 GB box. Lifecycle: `uploading → processing → indexed → failed`.
- **One job per document**, made **idempotent by delete-then-insert in a
  transaction**: on every (re)run, `DELETE FROM chunks WHERE document_id = ?`
  then insert the fresh set; flip `status='indexed'` **only after commit**.
  `UNIQUE(document_id, chunk_index)` is a belt-and-suspenders guard.
- **Retrieval filters on `status='indexed'`**, so a processing/failed doc is
  never half-searched (atomic visibility).
- **~3 retries with exponential backoff**; on exhaustion set `status='failed'`
  with a stored `error_message`, surfaced in the UI. **Re-ingest = re-enqueue**
  (safe, thanks to delete-then-insert).
- **Batch embeddings** (~96 chunks/call) to cut round-trips; a failed batch just
  fails the job, which retries cleanly.

## Alternatives considered

- **In-process fire-and-forget.** Rejected: loses in-flight work on every
  deploy/restart, no retries, uncontrolled concurrency — unacceptable with real
  users.
- **External queue (Redis + BullMQ / separate worker service).** Deferred:
  over-provisioned until ingestion volume actually competes with chat latency;
  the job table is the interface, so splitting the worker out later is trivial.
- **Resumable per-batch progress.** Rejected: bookkeeping complexity;
  delete-then-insert is correct regardless of where a prior attempt died.

## Consequences

- Ingestion survives deploys and restarts; retries are safe and duplicate-free.
- Boundary caps ([ADR-0011](./0011-cost-and-abuse-controls.md)) reject oversized
  inputs *before* enqueue so they never burn retries.
- The in-process worker shares the container's `mem_limit`; the concurrency cap
  is load-bearing, not cosmetic.
