import { describe, expect, it } from "vitest"

import {
  createFakeEmbedder,
  EMBEDDING_DIMENSIONS,
} from "../src/ingest/embeddings.ts"

/**
 * The fake embedder is what CI runs instead of a real model (ADR-0012). It must
 * be deterministic (same text → same vector, so retrieval assertions are exact),
 * shaped right (1536-d), and order-preserving across a batch.
 */
describe("fake embedder", () => {
  const embedder = createFakeEmbedder()

  it("returns one 1536-d vector per input, in order", async () => {
    const vectors = await embedder.embed(["a", "b", "c"])
    expect(vectors).toHaveLength(3)
    for (const v of vectors) expect(v).toHaveLength(EMBEDDING_DIMENSIONS)
  })

  it("is deterministic and content-addressed", async () => {
    const [first] = await embedder.embed(["repeatable text"])
    const [again] = await embedder.embed(["repeatable text"])
    const [other] = await embedder.embed(["different text"])
    expect(again).toEqual(first)
    expect(other).not.toEqual(first)
  })

  it("produces unit-norm vectors", async () => {
    const [v] = await embedder.embed(["normalize me"])
    const norm = Math.sqrt(v!.reduce((n, x) => n + x * x, 0))
    expect(norm).toBeCloseTo(1, 5)
  })

  it("handles a batch larger than one embedding call", async () => {
    const texts = Array.from({ length: 200 }, (_, i) => `chunk ${i}`)
    const vectors = await embedder.embed(texts)
    expect(vectors).toHaveLength(200)
    // Order preserved: the vector for `chunk 5` matches a fresh single embed.
    const [solo] = await embedder.embed(["chunk 5"])
    expect(vectors[5]).toEqual(solo)
  })
})
