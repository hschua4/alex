# ADR-0012 — Mocked models in CI, real-pgvector integration tests

**Status:** Accepted

## Context

RAG testing is thorny: the LLM is nondeterministic and costs money per call, and
the retrieval SQL (cosine + HNSW + filters) can't be meaningfully mocked. We need
a CI gate that is fast, free, and deterministic, plus a way to catch answer-
quality regressions without making CI flaky or expensive.

## Decision

- **Vitest** across the workspace.
- **Models fully mocked in the CI gate** — `MockLanguageModelV2` +
  `simulateReadableStream` for chat, deterministic fake vectors for embeddings.
  **No real LLM call in CI.**
- **Real-pgvector integration tests** (Testcontainers or a throwaway compose
  service) for retrieval + ingestion — exercise the cosine filter, per-doc cap,
  similarity floor ([ADR-0004](./0004-retrieval-design.md)), and `status`-gated
  visibility + delete-then-insert idempotency
  ([ADR-0006](./0006-async-ingestion-pgboss.md)) against a real vector index.
- **Unit tests** on the bug-prone pure functions: chunker boundaries/overlap,
  `[n]` citation validation/mapping ([ADR-0005](./0005-numbered-citations.md)),
  condense-skip logic, cap/floor merge.
- **Opt-in real-model eval suite** *outside* the CI gate — hits real models on a
  tiny fixture corpus to sanity-check grounding + citation accuracy; run by hand
  when tuning prompts or chunking.

## Alternatives considered

- **Real-model calls in the main gate.** Rejected: flaky, slow, and costs money
  per CI run; nondeterminism makes assertions brittle.
- **Stub/mock the vector DB.** Rejected: the retrieval logic most likely to be
  subtly wrong only manifests against a real pgvector.

## Consequences

- CI is deterministic, fast, and free.
- Quality regressions are visible via a deliberate, separate eval run rather than
  a noisy gate.
- Requires a pgvector test container in CI and local runs.
