# ADR-0002 — better-auth + same-origin cookies

**Status:** Accepted

## Context

Multi-user ([ADR-0001](./0001-multi-user-tenancy.md)) requires authentication.
The stack is a Hono API + a Vite React SPA in one pnpm monorepo, deployed on the
Skylab VPS. Two coupled questions: which auth mechanism, and whether web + API
share an origin (which decides how sessions are transported).

## Decision

- **better-auth** — email/password with sessions stored in the same Postgres,
  httpOnly cookies. Mirrors Kilo's existing better-auth + OAuth setup on the same
  VPS, so it is a known quantity here. OAuth/email-verification can be added
  incrementally.
- **Same origin** — Hono serves the built Vite assets; the API lives under the
  same host (e.g. `alex.hschua.com`, API under `/api`). The Vite dev proxy
  mirrors this so dev and prod behave identically.

## Alternatives considered

- **Managed auth (Clerk/WorkOS/Auth0).** Rejected for v1: a vendor + monthly
  cost + a shadow user table, and cross-origin cookie handling, for capabilities
  better-auth already covers on this stack.
- **Split domains** (`app.` + `api.`). Rejected: forces `SameSite=None`, CORS
  with credentials, cookie-domain config, and Safari/ITP third-party-cookie
  breakage — all avoided by staying same-origin.
- **Bearer tokens in memory.** Rejected: hand-rolled refresh and loss of
  httpOnly's XSS protection, with no benefit given same-origin cookies work.

## Consequences

- No CORS configuration; the tightest XSS/CSRF story via httpOnly + same-site.
- Auth tables (`user`/`session`/`account`) live in Alex's own database on the
  shared Postgres.
- The API deploy unit also owns the frontend build — one container, one deploy.
