# ADR-0011 — Invite-only + caps + rate limit + usage logging

**Status:** Accepted

## Context

Every user's chats **and** embeddings run through one shared OpenRouter key — our
bill. In a multi-user product ([ADR-0001](./0001-multi-user-tenancy.md)) with
public-ish signup, one heavy or malicious user (mass uploads, rapid chats, huge
PDFs) can run up real money. Single-user builds ignore this; we can't.

## Decision

- **Invite-only for v1** — better-auth with open signup disabled (invite code /
  allowlist). The cheapest abuse control is not having anonymous strangers on the
  key yet. Flip to open signup once limits + monitoring mature.
- **Hard boundary caps**, rejected at the API edge before any work: max upload
  size (~20 MB), max pages per PDF (~300). Enforced before enqueue so bad input
  never burns ingestion retries ([ADR-0006](./0006-async-ingestion-pgboss.md)).
- **Per-user chat rate limit** (Hono middleware; counter in Postgres or memory).
- **Per-assistant-message token-usage logging** from the AI SDK `onFinish` usage
  — the data needed the day quotas or a cost view appear.

## Alternatives considered

- **Open signup + real quotas/billing in v1.** Rejected: quotas/billing is a
  whole subsystem; invite-gating + caps + logging covers the risk far cheaper.
- **No controls (trust users).** Rejected: an uncapped shared key is an
  open-ended liability.

## Consequences

- v1 is safe to run on a personal key without a billing system.
- Usage data accrues from day one, so quotas later are additive, not a
  migration.
- The model allowlist ([ADR-0010](./0010-model-picker.md)) bounds per-request
  worst case; these controls bound aggregate and per-user volume.

## Implementation note

The per-user chat rate limit landed with invite codes
([ADR-0013](./0013-invite-codes.md)): an in-memory fixed window of 30 turns
per 10 minutes on chat and regenerate. Invite-only now also accepts expiring
invite codes alongside the email allowlist.
