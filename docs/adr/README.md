# Architecture Decision Records

Each ADR captures one decision with real trade-offs: the context that forced it,
the decision, the alternatives weighed, and the consequences we accept. They are
append-only — supersede rather than edit once a decision is acted on.

Format per record: **Status · Context · Decision · Alternatives considered ·
Consequences**.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-multi-user-tenancy.md) | Multi-user tenancy from v1 | Accepted |
| [0002](./0002-auth-and-origin.md) | better-auth + same-origin cookies | Accepted |
| [0003](./0003-per-message-document-selection.md) | Per-message document selection; block send on empty | Accepted |
| [0004](./0004-retrieval-design.md) | Chunking + top-k/per-doc-cap/floor, no reranker | Accepted |
| [0005](./0005-numbered-citations.md) | Prompt-based numbered citations with validation | Accepted |
| [0006](./0006-async-ingestion-pgboss.md) | Async ingestion via pg-boss; idempotent delete-then-insert | Accepted |
| [0007](./0007-originals-in-r2.md) | Store original files in R2 | Accepted |
| [0008](./0008-pgvector-on-shared-postgres.md) | Swap shared Postgres to pgvector image, pin pg16 | Accepted |
| [0009](./0009-hono-rpc-types.md) | Hono RPC type-sharing; packages/db API-only | Accepted |
| [0010](./0010-model-picker.md) | User-selectable answer model, server-allowlisted | Accepted |
| [0011](./0011-cost-and-abuse-controls.md) | Invite-only + caps + rate limit + usage logging | Accepted |
| [0012](./0012-testing-strategy.md) | Mocked models in CI, real-pgvector integration tests | Accepted |
