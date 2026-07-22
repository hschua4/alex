import { describe, expect, it } from "vitest"

import {
  extractCitationMarkers,
  validateCitations,
} from "../src/chat/citations.ts"
import type { RetrievedChunk } from "../src/chat/retrieval.ts"

/**
 * Citation validation (ADR-0005): the model's `[n]` markers are prompted for, then
 * checked — invalid or invented numbers are dropped, and the sources panel is
 * populated only from chunks the answer actually cited.
 */

function chunk(n: number, doc = "A"): RetrievedChunk {
  return {
    n,
    chunkId: `chunk-${n}`,
    documentId: doc,
    documentName: `${doc}.pdf`,
    content: `The full content of passage ${n}.`,
    page: n,
    chunkIndex: n * 10,
    similarity: 0.9,
  }
}

describe("extractCitationMarkers", () => {
  it("collects distinct [n] markers", () => {
    expect(extractCitationMarkers("A [1] then B [2][1] and C [3].")).toEqual([
      1, 2, 3,
    ])
  })

  it("returns nothing when there are no markers", () => {
    expect(extractCitationMarkers("no citations here")).toEqual([])
  })
})

describe("validateCitations", () => {
  const chunks = [chunk(1), chunk(2, "B"), chunk(3, "C")]

  it("maps used markers to their chunks in ascending order", () => {
    const cites = validateCitations("Claim two [2]. Claim one [1].", chunks)
    expect(cites.map((c) => c.n)).toEqual([1, 2])
    expect(cites[0]).toMatchObject({
      n: 1,
      documentId: "A",
      documentName: "A.pdf",
      page: 1,
      chunkIndex: 10,
      chunkId: "chunk-1",
    })
  })

  it("drops markers that don't map to a retrieved chunk", () => {
    // [9] was never retrieved (invented by the model) — it must not appear.
    const cites = validateCitations("Real [1] but invented [9].", chunks)
    expect(cites.map((c) => c.n)).toEqual([1])
  })

  it("includes only chunks the answer actually cited", () => {
    const cites = validateCitations("Only cites [3].", chunks)
    expect(cites.map((c) => c.n)).toEqual([3])
    expect(cites[0]?.documentId).toBe("C")
  })

  it("returns nothing when the answer cites nothing", () => {
    expect(validateCitations("An ungrounded answer.", chunks)).toEqual([])
  })

  it("snapshots a snippet of the chunk content", () => {
    const [cite] = validateCitations("[1]", chunks)
    expect(cite?.snippet).toBe("The full content of passage 1.")
  })
})
