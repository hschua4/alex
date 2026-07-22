import { describe, expect, it } from "vitest"

import type { Candidate } from "@alex/db"

import {
  PER_DOC_CAP,
  rankCandidates,
  SIMILARITY_FLOOR,
  TOP_K,
} from "../src/chat/retrieval.ts"

/**
 * The pure retrieval ranking (ADR-0004): per-doc cap, similarity floor, top-k.
 * The vector search itself is covered against real pgvector in
 * `chat.integration.test.ts`; this pins the fairness/quality rules deterministically.
 */

/** Build a descending-similarity candidate list, as `retrieveCandidates` returns. */
function candidates(
  specs: { doc: string; sim: number }[],
): Candidate[] {
  return specs.map((s, i) => ({
    chunkId: `c${i}`,
    documentId: s.doc,
    documentName: `${s.doc}.pdf`,
    content: `chunk ${i} from ${s.doc}`,
    page: 1,
    chunkIndex: i,
    similarity: s.sim,
  }))
}

describe("rankCandidates", () => {
  it("caps any single document to PER_DOC_CAP chunks", () => {
    // 8 strong chunks all from one doc; only the cap should survive from it.
    const input = candidates(
      Array.from({ length: 8 }, (_, i) => ({ doc: "A", sim: 0.9 - i * 0.01 })),
    )
    const ranked = rankCandidates(input)
    expect(ranked).toHaveLength(PER_DOC_CAP)
    expect(ranked.every((c) => c.documentId === "A")).toBe(true)
  })

  it("keeps the best per document — one doc can't crowd out the others", () => {
    const input = candidates([
      { doc: "A", sim: 0.9 },
      { doc: "A", sim: 0.88 },
      { doc: "A", sim: 0.86 },
      { doc: "A", sim: 0.84 },
      { doc: "A", sim: 0.82 },
      { doc: "A", sim: 0.8 }, // 6th A — dropped by the cap
      { doc: "B", sim: 0.79 },
      { doc: "C", sim: 0.78 },
    ])
    const ranked = rankCandidates(input)
    const docs = new Set(ranked.map((c) => c.documentId))
    expect(docs.has("B")).toBe(true)
    expect(docs.has("C")).toBe(true)
    expect(ranked.filter((c) => c.documentId === "A")).toHaveLength(PER_DOC_CAP)
  })

  it("drops candidates below the similarity floor", () => {
    const input = candidates([
      { doc: "A", sim: 0.9 },
      { doc: "B", sim: SIMILARITY_FLOOR + 0.01 },
      { doc: "C", sim: SIMILARITY_FLOOR - 0.05 },
      { doc: "D", sim: 0.02 },
    ])
    const ranked = rankCandidates(input)
    expect(ranked.map((c) => c.documentId)).toEqual(["A", "B"])
  })

  it("always keeps the single best chunk even if all are below the floor", () => {
    const input = candidates([
      { doc: "A", sim: 0.1 },
      { doc: "B", sim: 0.05 },
    ])
    const ranked = rankCandidates(input)
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.documentId).toBe("A")
  })

  it("keeps at most TOP_K chunks across many documents", () => {
    const input = candidates(
      Array.from({ length: 20 }, (_, i) => ({
        doc: `doc${i}`,
        sim: 0.9 - i * 0.01,
      })),
    )
    const ranked = rankCandidates(input)
    expect(ranked).toHaveLength(TOP_K)
  })

  it("numbers the kept chunks 1..n in rank order", () => {
    const input = candidates([
      { doc: "A", sim: 0.9 },
      { doc: "B", sim: 0.8 },
      { doc: "C", sim: 0.7 },
    ])
    const ranked = rankCandidates(input)
    expect(ranked.map((c) => c.n)).toEqual([1, 2, 3])
  })

  it("returns nothing for no candidates", () => {
    expect(rankCandidates([])).toEqual([])
  })
})
