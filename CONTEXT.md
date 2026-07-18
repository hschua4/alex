# Alex — Design Context

A RAG app for chatting with your documents. Users create **projects**, upload
**documents** into them, then open **chat sessions** where each question is
answered *only* from a chosen set of documents, with numbered citations back to
the source passages.

This document is the shared mental model: the domain language, the entities, the
core flows, and the constraints that shaped them. Individual decisions with
trade-offs are recorded as ADRs in [docs/adr/](./docs/adr/).

> Status: **greenfield**. Nothing here is built yet — the only artifact on disk
> is `RAG Chat App.html`, a design prototype. This document is the plan.

---

## 1. Goals & constraints

- **Multi-user from day one.** Every row is scoped to a `user_id`. Invite-only
  for v1; open signup deferred (see [ADR-0011](./docs/adr/0011-cost-and-abuse-controls.md)).
- **Answers are always grounded.** Alex answers *from your documents*, always
  with sources. It is never a bare chatbot.
- **Slots into the Skylab VPS.** Single Hetzner box (2 vCPU / 4 GB RAM) shared
  with resitly, odin, tradeai, kilo. Constraints inherited from that:
  - **RAM is tight** → every container gets a `mem_limit`; the embedding worker
    runs in-process with a hard concurrency cap so it can't starve chat latency.
  - **Disk fills fast** → original uploaded files live in **R2**, not on the box
    ([ADR-0007](./docs/adr/0007-originals-in-r2.md)).
  - **Shared Postgres** → Alex gets its own role + database on the one shared
    instance; the shared image is swapped to `pgvector/pgvector:pg16`
    ([ADR-0008](./docs/adr/0008-pgvector-on-shared-postgres.md)).
  - **Single owner, low ops** → optimize for "set up once," lean on Traefik +
    healthchecks + gated migrations for zero-downtime deploys.

## 2. Ubiquitous language

| Term | Meaning |
|---|---|
| **Project** | A workspace owned by a user; holds documents and chat sessions. |
| **Document** | An uploaded file (PDF/DOCX) in a project. Has an ingestion `status`. |
| **Chunk** | A ~600-token slice of a document with an embedding, page number, char offset, and chunk index. The unit of retrieval. |
| **Ingestion job** | Background job that turns a document into indexed chunks: extract → chunk → embed → store. |
| **Chat session** | A conversation within a project. |
| **Message** | One turn (user or assistant) in a session. |
| **Selected documents** | The per-message set of documents retrieval is scoped to. Mutable turn-to-turn. |
| **Condensing** | Rewriting a follow-up ("what about its pricing?") into a standalone query before retrieval. |
| **Retrieval** | Cosine top-k search over chunks, filtered to selected + indexed documents. |
| **Citation** | A numbered `[n]` reference in an assistant answer, mapped to a retrieved chunk `{doc, page · chunk, snippet}`. |

## 3. Entities & relationships

```
user
 ├─ project                    (owned by user)
 │   ├─ document               (in project; status: uploading→processing→indexed→failed)
 │   │   └─ chunk              (embedding, page, char_offset, chunk_index; UNIQUE(document_id, chunk_index))
 │   └─ chat_session
 │       └─ message            (role, content, status, model_id, selected_document_ids, token_usage)
 │           └─ message_citation  (n, chunk_id, snippet-at-time)
 └─ auth: user / session / account   (better-auth tables, same Postgres)
```

Key modelling choices:

- **Selection lives on the message**, not the session — a user can change which
  documents are in scope on any turn ([ADR-0003](./docs/adr/0003-per-message-document-selection.md)).
  Each user message records its `selected_document_ids`; retrieval filters on
  *that turn's* set.
- **Citations are ephemeral per answer** — `[1]` in one message is unrelated to
  `[1]` in the next. `message_citation` snapshots the snippet as it was, so
  history renders faithfully even if the document is later re-indexed.
- **Provenance is recorded, not derived** — each assistant message stores the
  `model_id` that produced it and its `token_usage`. Cheap now; essential the
  day quotas or a model comparison view exist.

## 4. Core flow — a grounded answer

1. **Compose.** User selects ≥1 document (send is blocked with 0 —
   [ADR-0003](./docs/adr/0003-per-message-document-selection.md)) and picks a
   model from the server-allowlisted list ([ADR-0010](./docs/adr/0010-model-picker.md)).
2. **Persist the user turn first** — message + `selected_document_ids` are saved
   *before* retrieval, so provenance survives a failed generation and the turn
   can be retried without re-retrieving.
3. **Condense** (follow-ups only) — `gpt-4o-mini` rewrites the question into a
   standalone query using the last ~6 turns. First message skips this.
4. **Retrieve** — embed the query (`text-embedding-3-small`), cosine search the
   HNSW index filtered to `status='indexed'` ∧ selected docs. Over-fetch, apply
   a **per-doc cap (5)** and a **light similarity floor**, keep **top-k 8**
   ([ADR-0004](./docs/adr/0004-retrieval-design.md)).
5. **Generate** — feed the chunks *pre-numbered* into the prompt; the answer
   model cites claims with `[n]` ([ADR-0005](./docs/adr/0005-numbered-citations.md)).
   Stream tokens to the client via the AI SDK.
6. **Finalize** on `onFinish` — **validate** the `[n]` markers (drop any that
   don't map to a retrieved chunk), then save the assistant message with its
   text, validated citations, `model_id`, and `token_usage`. A cancelled stream
   is kept as `stopped`; regenerate is additive (`regenerated_from`).
7. **Render** — the sources panel shows the cited passages for the *latest*
   answer: `{doc, page · chunk, snippet}`.

## 5. Core flow — ingestion

1. Upload rejected at the boundary if over caps (size ≤ 20 MB, pages ≤ ~300 —
   [ADR-0011](./docs/adr/0011-cost-and-abuse-controls.md)).
2. Original stored in **R2**; a `document` row is created `status='processing'`
   and an **ingestion job enqueued** (pg-boss, same Postgres —
   [ADR-0006](./docs/adr/0006-async-ingestion-pgboss.md)).
3. Worker: extract text (`unpdf`) → recursive chunk (~600 tok / ~80 overlap,
   storing page + char offset + chunk index) → batch-embed (~96/call) →
   **delete-then-insert** chunks in a transaction → flip `status='indexed'`
   **after commit**.
4. Failure → up to 3 retries → `status='failed'` with a stored `error_message`,
   surfaced in the UI. Re-ingest = re-enqueue (safe, idempotent —
   [ADR-0006](./docs/adr/0006-async-ingestion-pgboss.md)).

Retrieval only ever sees `status='indexed'` documents, so a doc that is
processing or failed is never half-searched.

## 6. Architecture

- **Monorepo** (pnpm workspaces): `apps/web` (React 19 / Vite / TanStack Query),
  `apps/api` (Hono on `@hono/node-server`), `packages/db` (Drizzle schema +
  client, **API-only** — web never imports it).
- **Type-sharing** via **Hono RPC** (`hc<AppType>`) + `@hono/zod-validator`;
  end-to-end types with no codegen ([ADR-0009](./docs/adr/0009-hono-rpc-types.md)).
- **Same origin** — Hono serves the built SPA; API under the same host, so
  httpOnly cookie auth "just works" with no CORS
  ([ADR-0002](./docs/adr/0002-auth-and-origin.md)).
- **Auth**: better-auth (email/password + sessions in Postgres), mirroring
  Kilo's existing better-auth setup.

## 7. Models

| Role | Model | Selectable? |
|---|---|---|
| Answer generation | `anthropic/claude-3.7-sonnet` (default) | **Yes** — per message, from a server allowlist ([ADR-0010](./docs/adr/0010-model-picker.md)) |
| Query condensing | `openai/gpt-4o-mini` | No — pinned, env-configurable |
| Embeddings | `openai/text-embedding-3-small` (1536-d) | **Never** — changing it invalidates the entire index |

All via the **OpenRouter** provider on one API key. The model picker swaps
*only* the answer model; the allowlist is enforced server-side on every request.

## 8. Deployment

- **VPS + docker-compose**, joining the Skylab external `proxy` (Traefik TLS +
  routing labels) and `postgres` networks. Own `alex` role + DB via the shared
  `bootstrap.sh`. Likely `alex.hschua.com`.
- **Deploy = migrations gate the swap**:
  `docker compose pull` → `docker compose run --rm app db:migrate` (halts on
  failure) → `docker compose up -d` with `start-first` + a healthcheck.
- **Dev/prod parity**: dev compose pinned to `pgvector/pgvector:pg16` to match
  the swapped shared prod image (not pg17).

## 9. Testing

- **Vitest**. **Models fully mocked in the CI gate** (`MockLanguageModelV2`,
  deterministic fake embeddings) — CI is free, fast, deterministic.
- **Real-pgvector integration tests** (Testcontainers) for retrieval + ingestion
  — the cosine filter, per-doc cap, floor, and status-gating can't be mocked
  meaningfully.
- **Opt-in real-model eval suite** outside CI, run by hand when tuning prompts
  or chunking, to catch grounding/citation regressions
  ([ADR-0012](./docs/adr/0012-testing-strategy.md)).

## 10. Deliberately deferred (v2+)

- Cross-encoder / LLM **reranker** (first quality lever if answers disappoint).
- **No-retrieval router** (answer "summarize what we said" without a search).
- Per-user **dollar quotas / billing**; **open signup**.
- In-app **PDF viewer** / span-highlight jump-to-source (page-level citations
  suffice for v1; char offsets are stored now as insurance).
- **Multi-instance scale-out** (single container for now; R2 + Postgres already
  make the app stateless enough to split later).

## 11. Open questions

Not yet decided (low-stakes, revisit before build):

1. **App error monitoring** — Sentry vs. Traefik/healthchecks.io + structured logs.
2. **Secrets layout** — Alex's OpenRouter key, R2 creds, better-auth secret in
   the per-app `.env` under `/srv/infra` vs. a separate mechanism.
