import type { Candidate } from "@alex/db"

/**
 * Retrieval ranking (ADR-0004) — the pure part. `retrieveCandidates` in the db
 * package supplies the over-fetched, cosine-sorted candidates; this applies the
 * fairness and quality rules on top:
 *
 *  - **per-doc cap** — no single document contributes more than {@link PER_DOC_CAP}
 *    chunks, so one document can't crowd out the others the user selected;
 *  - **similarity floor** — drop weak matches below {@link SIMILARITY_FLOOR}, but
 *    always keep the single best chunk so context is never empty;
 *  - **top-k** — keep at most {@link TOP_K}.
 *
 * Pure and deterministic so it can be unit-tested without a database.
 */

/** No single document contributes more than this many chunks (ADR-0004). */
export const PER_DOC_CAP = 5
/** Cosine matches below this are dropped — unless nothing else survives. */
export const SIMILARITY_FLOOR = 0.2
/** Final number of chunks fed to the answer model. */
export const TOP_K = 8
/** How many candidates to over-fetch before capping/flooring (ADR-0004). */
export const OVER_FETCH = 40

/** A ranked chunk with its per-answer citation number assigned (`[n]`). */
export type RetrievedChunk = Candidate & { n: number }

type RankOptions = {
  perDocCap?: number
  floor?: number
  topK?: number
}

/**
 * Rank over-fetched candidates into the final numbered context. Input must be
 * sorted by descending similarity (as `retrieveCandidates` returns it). Numbers
 * are assigned `1..n` in final rank order — ephemeral and per-answer (ADR-0005).
 */
export function rankCandidates(
  candidates: Candidate[],
  options: RankOptions = {},
): RetrievedChunk[] {
  const perDocCap = options.perDocCap ?? PER_DOC_CAP
  const floor = options.floor ?? SIMILARITY_FLOOR
  const topK = options.topK ?? TOP_K

  // Per-doc cap, walking highest-similarity first so each doc keeps its best.
  const capped: Candidate[] = []
  const perDoc = new Map<string, number>()
  for (const c of candidates) {
    const seen = perDoc.get(c.documentId) ?? 0
    if (seen >= perDocCap) continue
    perDoc.set(c.documentId, seen + 1)
    capped.push(c)
  }

  // Floor, but never return empty context: keep the single best if all fall below.
  let kept = capped.filter((c) => c.similarity >= floor)
  if (kept.length === 0 && capped[0]) kept = [capped[0]]

  return kept.slice(0, topK).map((c, i) => ({ ...c, n: i + 1 }))
}
