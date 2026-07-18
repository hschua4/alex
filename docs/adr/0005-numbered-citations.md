# ADR-0005 — Prompt-based numbered citations with validation

**Status:** Accepted

## Context

The prototype's sources panel renders **numbered** passages for "the latest
answer": each card shows a number badge, document name, a location
(`p. 14 · chunk 37`), and the snippet. So the assistant's prose must reference
those numbers. There are several ways to produce that linkage, differing in
accuracy, latency, and streaming compatibility.

## Decision

**Prompt the model to cite, then validate.** Feed retrieved chunks *pre-numbered*
into the context (`[1] …text…  [2] …text…`) and instruct the model to cite
claims with `[n]` matching the passages. Stream the answer as-is. On `onFinish`,
**validate**: drop or ignore any `[n]` that doesn't map to a retrieved chunk;
populate the panel from the chunks actually cited.

Numbering is **per-answer and ephemeral** — `[1]` in one message is unrelated to
`[1]` in the next. `message_citation` snapshots the snippet at answer time.

## Alternatives considered

- **Post-hoc grounding** (second pass / sentence-to-chunk similarity). Deferred
  to v2: more accurate mapping but adds a model call + latency and complexity.
- **No inline markers** (just list retrieved chunks). Rejected: loses the
  numbered-badge UX the prototype is built around.

## Consequences

- Streams cleanly through AI SDK v6; zero extra model calls.
- The model's weakness (miscited or invented `[n]`) is contained by the
  validation step, not trusted.
- Citation numbering is inherently per-message; the UI keys the panel off the
  latest answer, consistent with this.
