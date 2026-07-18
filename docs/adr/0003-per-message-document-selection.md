# ADR-0003 — Per-message document selection; block send on empty

**Status:** Accepted

## Context

When chatting, a user picks which documents an answer draws from. That selection
could be fixed for a whole session (chosen at creation) or mutable per message.
The prototype puts source chips in the chat composer, not a setup wizard. A
related edge: what happens when zero documents are selected.

## Decision

- **Selection is mutable per message**, recorded on each user message as
  `selected_document_ids`. Retrieval filters on *that turn's* set.
- **Zero documents selected → block send** with an inline hint. Grounding is
  never silently bypassed.

## Alternatives considered

- **Fixed per session.** Rejected: forces a new session just to change scope,
  which contradicts real usage ("now also consider this doc") and the prototype.
- **Empty selection = search all docs in project.** Rejected as a *default*: it
  silently changes scope. Project-wide search, if wanted later, should be an
  explicit "All sources" chip resolving to every doc id — same retrieval path,
  deliberate intent.
- **Empty selection = plain LLM chat, no retrieval.** Rejected: breaks the
  product's grounding promise and empties the citations UI.

## Consequences

- History is honest: replaying an old answer shows exactly which docs it could
  see.
- Retrieval always runs against a non-empty, explicit doc set.
- Requires storing selection per message (join table or `jsonb` array) — see
  the schema in [CONTEXT.md §3](../../CONTEXT.md).
