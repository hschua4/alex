# ADR-0009 — Hono RPC type-sharing; packages/db API-only

**Status:** Accepted

## Context

`apps/web` (React / TanStack Query) talks to `apps/api` (Hono) inside one pnpm
workspace, so they can share types directly. We need the frontend to have a
typed, runtime-validated view of the API without contract drift.

## Decision

- **Hono RPC** — export the Hono `AppType` from the API, consume it in web via
  `hc<AppType>` for a fully typed client with **no codegen**. Pair with
  **`@hono/zod-validator`** (Zod 4) at each route boundary for runtime input
  validation and simultaneously-inferred input/output types. The typed client
  drops into TanStack Query's `queryFn`/`mutationFn`.
- **`packages/db` is API-only** — it holds the Drizzle schema + client. Web
  **never** imports it; web only sees the API's request/response types via `hc`,
  never DB row types.

## Alternatives considered

- **Shared Zod schemas package + hand-written fetch wrappers.** Rejected: more
  boilerplate and manual route-sync for no gain over `hc` in a first-party
  monorepo.
- **OpenAPI + client codegen.** Rejected for v1: heaviest option; worth it only
  when exposing the API to third-party consumers.

## Consequences

- End-to-end type safety with no build step; refactor an endpoint and the web
  build breaks exactly where it should.
- Web depends on the API's type export — acceptable coupling for a first-party
  SPA.
- The DB stays swappable and the API boundary stays honest (DB rows never leak
  to the client).
