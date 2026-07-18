# ADR-0001 — Multi-user tenancy from v1

**Status:** Accepted

## Context

Alex could ship as a single-user self-hosted tool (no accounts, no `user_id`) or
as a multi-user hosted product (accounts, auth, every row scoped to a user).
Single-user is dramatically less surface area — no auth layer, no per-row
scoping. But the product intent is a hosted app where people manage their own
projects and history.

## Decision

Build **multi-user from v1**. Every domain row is scoped to a `user_id`. Access
to any project/document/session/message is authorized against the authenticated
user.

## Alternatives considered

- **Single-user v1, add auth later.** Rejected: retrofitting multi-tenancy
  touches every table, every query, and every endpoint — it is not an additive
  layer, it is a rewrite of the access path. Cheaper to pay for it up front than
  to migrate a populated single-tenant schema.

## Consequences

- Every query carries a tenant filter; authorization is a first-class concern
  from the first endpoint.
- Enables invite-only rollout and per-user cost controls
  ([ADR-0011](./0011-cost-and-abuse-controls.md)).
- Requires an auth mechanism ([ADR-0002](./0002-auth-and-origin.md)) before any
  real data flows.
