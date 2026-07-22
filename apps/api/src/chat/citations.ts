import type { CitationInput } from "@alex/db"

import type { RetrievedChunk } from "./retrieval.ts"

/**
 * Citation validation (ADR-0005). The model is prompted to cite with `[n]`, but
 * its markers are never trusted: after generation we scan the answer for `[n]`
 * tokens, keep only those that map to a retrieved chunk, and snapshot the cited
 * chunks — document name, page, chunk index, and text — as they were at answer
 * time. Invalid or invented numbers are dropped; the sources panel is populated
 * only from chunks the answer actually cited.
 */

/** Snapshot length for a citation snippet — the sources panel shows a preview. */
const SNIPPET_CHAR_LIMIT = 600

/** Every distinct `[n]` marker that appears in `text`, as numbers. */
export function extractCitationMarkers(text: string): number[] {
  const seen = new Set<number>()
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    seen.add(Number(match[1]))
  }
  return [...seen]
}

/**
 * Map the `[n]` markers actually used in `text` to the retrieved chunks they
 * reference, dropping any that don't resolve. Returns validated citations in
 * ascending `n` order, ready to persist (`CitationInput`).
 */
export function validateCitations(
  text: string,
  chunks: RetrievedChunk[],
): CitationInput[] {
  const byNumber = new Map(chunks.map((c) => [c.n, c]))
  const used = extractCitationMarkers(text)
    .filter((n) => byNumber.has(n))
    .sort((a, b) => a - b)

  return used.map((n) => {
    const chunk = byNumber.get(n)!
    return {
      n,
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      page: chunk.page,
      chunkIndex: chunk.chunkIndex,
      snippet: chunk.content.slice(0, SNIPPET_CHAR_LIMIT),
    }
  })
}
