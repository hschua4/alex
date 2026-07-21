import { getEncoding } from "js-tiktoken"
import { describe, expect, it } from "vitest"

import { chunkPages } from "../src/ingest/chunker.ts"

/**
 * Unit tests for the chunker — the bug-prone pure function ADR-0012 singles out.
 * We assert the invariants that make retrieval and re-ingestion correct:
 * monotonic indices, honest provenance (page + char offset that actually points
 * at the content), the token budget, and real overlap between neighbours.
 */
const enc = getEncoding("cl100k_base")
const tokens = (s: string) => enc.encode(s).length

describe("chunkPages", () => {
  it("returns no chunks for empty or whitespace-only pages", () => {
    expect(chunkPages([])).toEqual([])
    expect(chunkPages([{ page: 1, text: "   \n\n  " }])).toEqual([])
  })

  it("keeps a short page as a single chunk with offset 0", () => {
    const chunks = chunkPages([{ page: 1, text: "A short paragraph." }])
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ page: 1, charOffset: 0, chunkIndex: 0 })
    expect(chunks[0]?.content).toBe("A short paragraph.")
  })

  it("charOffset points at the chunk's content within its page", () => {
    const text = "Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph."
    const chunks = chunkPages([{ page: 1, text }], {
      chunkTokens: 4,
      overlapTokens: 0,
    })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(text.slice(c.charOffset, c.charOffset + c.content.length)).toBe(
        c.content,
      )
    }
  })

  it("respects the token budget and overlaps neighbours", () => {
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} carries a little unique payload here.`,
    ).join(" ")
    const chunks = chunkPages([{ page: 1, text: sentences }], {
      chunkTokens: 60,
      overlapTokens: 15,
    })

    expect(chunks.length).toBeGreaterThan(2)
    // Budget (allow a little slack for separators re-counted on the slice).
    for (const c of chunks) expect(tokens(c.content)).toBeLessThanOrEqual(75)
    // Overlap: each chunk begins with a run replayed from the end of its
    // predecessor, so the first word of `next` appears in `prev`.
    for (let i = 1; i < chunks.length; i++) {
      const firstWord = chunks[i]!.content.trim().split(/\s+/)[0] ?? ""
      expect(chunks[i - 1]!.content.includes(firstWord)).toBe(true)
    }
  })

  it("indexes chunks monotonically across pages and carries page numbers", () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")
    const chunks = chunkPages(
      [
        { page: 1, text: long },
        { page: 2, text: long },
      ],
      { chunkTokens: 20, overlapTokens: 4 },
    )
    expect(chunks.map((c) => c.chunkIndex)).toEqual(
      chunks.map((_, i) => i),
    )
    expect(chunks.some((c) => c.page === 1)).toBe(true)
    expect(chunks.some((c) => c.page === 2)).toBe(true)
    // Page 1 chunks all precede page 2 chunks.
    const firstPage2 = chunks.findIndex((c) => c.page === 2)
    expect(chunks.slice(0, firstPage2).every((c) => c.page === 1)).toBe(true)
  })

  it("hard-splits an unbreakable run that exceeds the budget", () => {
    const giant = "x".repeat(1200)
    const chunks = chunkPages([{ page: 1, text: giant }], {
      chunkTokens: 40,
      overlapTokens: 0,
    })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((c) => c.content).join("")).toBe(giant)
  })
})
