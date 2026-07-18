# ADR-0004 — Chunking + top-k/per-doc-cap/floor, no reranker

**Status:** Accepted

## Context

Retrieval quality is capped by chunking, and multi-document selection
([ADR-0003](./0003-per-message-document-selection.md)) introduces a fairness
problem: a naive top-k can return all chunks from one dominant document. Text is
extracted with `unpdf` (fairly flat) and embedded with `text-embedding-3-small`
(1536-d) over an HNSW cosine index.

## Decision

**Chunking:** recursive (paragraph/sentence-aware), **~600 tokens** per chunk,
**~80-token (~13%) overlap**. Store **page number + char offset + chunk index**
on every chunk (`UNIQUE(document_id, chunk_index)`).

**Retrieval:** embed the (possibly condensed) query, cosine search filtered to
`status='indexed'` ∧ selected docs. Over-fetch (~top-20), then:
- **per-doc cap 5** — no single document contributes more than 5 chunks;
- **light similarity floor** (~cosine < 0.2–0.25 dropped), but always keep ≥1
  best chunk so context is never empty;
- keep **top-k 8**.

**No reranker** in v1.

## Alternatives considered

- **Fixed-size token windows.** Rejected: slices mid-sentence/mid-table, worse
  retrieved-chunk coherence for little simplicity gain.
- **Layout/semantic chunking.** Rejected: `unpdf` gives flat text, so layout
  signal is unreliable; not worth the complexity for v1.
- **Global top-k, no per-doc cap.** Rejected: one doc can crowd out the others
  the user explicitly selected.
- **Full per-doc top-k then merge.** Rejected: token blow-up; the cap achieves
  fairness more cheaply.
- **Cross-encoder / LLM reranker.** Deferred to v2 — highest-leverage quality
  lever, but adds a model dependency and latency; ship without it first.

## Consequences

- Stored page + offset make page-level citations
  ([ADR-0005](./0005-numbered-citations.md)) and a future jump-to-source
  possible without a re-ingest.
- The floor/cap/merge logic is pure and must be unit-tested; the vector search
  itself needs a real-pgvector integration test
  ([ADR-0012](./0012-testing-strategy.md)).
- Changing chunk size or the embedding model forces a full re-index.
