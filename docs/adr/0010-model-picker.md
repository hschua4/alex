# ADR-0010 — User-selectable answer model, server-allowlisted

**Status:** Accepted

## Context

Chat runs through OpenRouter, which can route to many models. We want users to
choose which model answers, but a user-supplied model id is a direct cost/abuse
vector — nothing stops a client from requesting an expensive model on our key.
Condensing and embeddings have different constraints from the answer model.

## Decision

- **The answer model is user-selectable, per message, from a server-owned
  allowlist.** The web fetches the allowlist (`{id, label}[]`) from an endpoint;
  the chat route **validates the requested id against the allowlist on every
  request** (Zod enum built from the list) and rejects anything else. The UI can
  only show what the server allows.
- **The picker swaps only the answer model.** Default `claude-3.7-sonnet`;
  remember the user's last pick across sessions. The chosen `model_id` is stored
  on each assistant message.
- **Condensing stays pinned** to `gpt-4o-mini` (env-configurable). **Embeddings
  stay pinned** to `text-embedding-3-small` and are **never** user-selectable —
  changing the embedding model invalidates the entire HNSW index.

## Alternatives considered

- **Fixed single answer model.** Rejected: the user chose a picker; the value is
  letting people trade cost/quality per question.
- **Per-session model lock.** Rejected: per-message is consistent with
  per-message doc selection ([ADR-0003](./0003-per-message-document-selection.md))
  and lets history show which model answered each turn.
- **Trusting the client-supplied model id.** Rejected outright: a billing
  footgun.

## Consequences

- Adding/removing models is a server-config change; the client follows.
- Per-message `model_id` gives clean provenance and a basis for future
  per-model cost views.
- Ties into cost controls ([ADR-0011](./0011-cost-and-abuse-controls.md)) — the
  allowlist bounds worst-case per-request spend.
