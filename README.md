# Alex

Chat with your documents, with every answer grounded in sources.

You create **projects**, upload PDF/DOCX **documents** into them, and ask
questions in **chat sessions**. Each answer is drawn only from the documents you
select for that turn, and its claims carry numbered `[n]` citations that link
back to the source passages (document, page, snippet).

Live at [alex.hschua.com](https://alex.hschua.com). It's invite-only: if
you've been given an invite code, register with it at
[alex.hschua.com/login](https://alex.hschua.com/login?mode=register).

## Engineering highlights

- **Citations are checked, not trusted.** The model is asked to cite with
  `[n]`. After generation, every marker is checked against the chunks that
  were actually retrieved. Invented numbers are dropped, and the cited
  passages are saved with the answer so history survives a re-index
  ([citations.ts](./apps/api/src/chat/citations.ts),
  [ADR-0005](./docs/adr/0005-numbered-citations.md)).
- **Retrieval is fair across documents.** Candidates are over-fetched, each
  document is capped at 5 chunks so one large file can't crowd out the
  others, weak matches are dropped below a similarity floor (keeping at least
  the best one), and the top 8 are kept. The ranking is a pure function and
  unit-tested without a database
  ([retrieval.ts](./apps/api/src/chat/retrieval.ts),
  [ADR-0004](./docs/adr/0004-retrieval-design.md)).
- **Follow-up questions work.** A follow-up is rewritten into a standalone
  query before retrieval ("what about the second one?" becomes something
  searchable), while the answer model still sees the question as it was
  asked.
- **Ingestion is async and idempotent.** Uploads are queued with pg-boss and
  processed in-process (extract, chunk, embed). Retries and re-ingests
  delete and re-insert in one transaction, so a document is never
  half-indexed ([ADR-0006](./docs/adr/0006-async-ingestion-pgboss.md)).
- **Streaming has no race.** Answers are streamed over hand-written SSE. The
  assistant message and its validated citations are saved before the final
  `done` event, so the client never refetches stale data. Cancelling a stream
  keeps the partial answer as `stopped`.
- **Multi-tenant from day one.** Every query is scoped by `user_id`, and
  someone else's id returns the same 404 as a missing one
  ([ADR-0001](./docs/adr/0001-multi-user-tenancy.md)).
- **Cost is bounded.** The deployment runs on one shared model key, so there
  are upload and page caps, a server-side model allowlist, per-user chat
  rate limits, and token usage logged on every answer
  ([ADR-0011](./docs/adr/0011-cost-and-abuse-controls.md)). Access is by
  email allowlist or by an expiring, limited-use invite code that is claimed
  atomically at sign-up
  ([ADR-0013](./docs/adr/0013-invite-codes.md)).
- **Types run end to end.** Hono RPC carries the API's types to the React
  client with no codegen. Tests mock every model but run retrieval and
  ingestion against real pgvector via Testcontainers. CI gates the deploy on
  typecheck, lint, migrations and tests.

- **Design context:** [CONTEXT.md](./CONTEXT.md) covers the domain language,
  entities, core flows and constraints.
- **Decisions:** [docs/adr/](./docs/adr/) records each trade-off as an ADR (13 so far).
- **Deploying:** [docs/DEPLOY.md](./docs/DEPLOY.md) is the runbook.

## Stack

| Layer | Tech |
|---|---|
| Web | React 19, Vite, TanStack Query, Tailwind v4, shadcn/ui (Base UI) |
| API | Hono on Node, Hono RPC for end-to-end types ([ADR-0009](./docs/adr/0009-hono-rpc-types.md)) |
| Auth | better-auth: email/password, sessions in Postgres, invite-only |
| Data | Postgres 16 + pgvector (HNSW, cosine), Drizzle ORM |
| Ingestion | pg-boss queue, in-process worker: `unpdf`/`mammoth` → chunk → embed |
| Storage | Original uploads in S3-compatible storage: R2 in prod, MinIO in dev |
| Models | All via OpenRouter, using the Vercel AI SDK |

## Repository layout

```
apps/
  api/        Hono server: auth, projects, documents, chat (SSE), ingestion worker
    src/chat/     condense → retrieve → prompt → citation validation
    src/ingest/   extract → chunk → embed → store, pg-boss queue, S3 storage
  web/        React SPA: landing page at /, app at /app
packages/
  db/         Drizzle schema, migrations, DB client (used by the API only)
deploy/       Production compose file and .env template
docs/         ADRs and the deploy runbook
```

In production, the API serves the built SPA from the same origin, so cookie auth
works without CORS ([ADR-0002](./docs/adr/0002-auth-and-origin.md)).

## Getting started

### Prerequisites

- Node 22 and **pnpm 9** (`corepack enable`)
- Docker, for local Postgres + MinIO
- An [OpenRouter](https://openrouter.ai) API key

### 1. Install and start services

```bash
pnpm install
pnpm services:up      # Postgres (pgvector) on :5434, MinIO on :9000 (console :9001)
pnpm db:migrate
```

`services:up` also creates the `alex-documents` bucket in MinIO.

### 2. Configure the API

Create `apps/api/.env`:

```bash
DATABASE_URL=postgres://alex:alex@localhost:5434/alex
PORT=3000

BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:5173

# MinIO, standing in for R2
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=alex
S3_SECRET_ACCESS_KEY=alexsecret
S3_BUCKET=alex-documents
S3_FORCE_PATH_STYLE=true

OPENROUTER_API_KEY=sk-or-...
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_MODEL=text-embedding-3-small
CONDENSE_MODEL=openai/gpt-4o-mini
INGEST_CONCURRENCY=1
```

`.env` files are git-ignored. Never commit real keys. See
[deploy/.env.example](./deploy/.env.example) for every variable with comments.

> **Do not change `EMBEDDING_MODEL`** on a database that already has data.
> Doing so invalidates every stored embedding and requires a full re-index.

### 3. Invite yourself and run

Sign-up is limited to allowlisted emails:

```bash
pnpm invite add you@example.com
pnpm invite list
pnpm dev              # API on :3000, web on :5173 (proxies /api → :3000)
```

Open <http://localhost:5173/app> and sign up with the invited email.

Or mint a shareable invite code that expires (ADR-0013). It prints a sign-up
link with the code filled in:

```bash
pnpm invite code --days 7 --uses 3 --label "Acme interview"
pnpm invite codes                # status of every code
pnpm invite revoke ABCD-EFGH
```

## Scripts

Run from the repo root.

| Command | What it does |
|---|---|
| `pnpm dev` | Run the API (`tsx watch`) and web (Vite) in parallel |
| `pnpm build` | Build the SPA to `apps/web/dist` |
| `pnpm start` | Run the API, which also serves the built SPA |
| `pnpm services:up` / `db:up` | Start Postgres + MinIO / Postgres only |
| `pnpm db:down` | Stop the dev services |
| `pnpm db:generate` | Generate a migration from schema changes in `packages/db` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm invite add <email>` / `list` | Manage the email invite allowlist |
| `pnpm invite code` / `codes` / `revoke <code>` | Mint, list, and revoke expiring invite codes |
| `pnpm typecheck` / `lint` / `test` | Checks across all workspaces |

## Testing

Vitest across the workspace ([ADR-0012](./docs/adr/0012-testing-strategy.md)):

- **Models are fully mocked**, so tests need no API keys and make no paid calls.
- **Retrieval and ingestion integration tests** run against real pgvector through
  Testcontainers, so Docker must be running.
- Some tests need the **dev database up and migrated** (`pnpm db:up && pnpm
  db:migrate`). They connect to `localhost:5434` by default.

```bash
pnpm test
```

## Models

| Role | Default | Notes |
|---|---|---|
| Answer | `anthropic/claude-sonnet-5` | Users pick per message from a server-side allowlist in [models.ts](./apps/api/src/chat/models.ts) ([ADR-0010](./docs/adr/0010-model-picker.md)) |
| Query condensing | `openai/gpt-4o-mini` | Pinned; set with `CONDENSE_MODEL` |
| Embeddings | `text-embedding-3-small` (1536-d) | Never user-selectable |

## Deployment

Alex runs as one container on the Skylab VPS behind Traefik, using the shared
Postgres (with pgvector) and Cloudflare R2. A push to `main` runs the CI gate
(typecheck, lint, migrate, test), pushes an image to GHCR, then deploys.
Migrations must pass before the container is swapped. See
[docs/DEPLOY.md](./docs/DEPLOY.md) for the full runbook.
