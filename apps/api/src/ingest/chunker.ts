import { getEncoding } from "js-tiktoken"

import type { ExtractedPage } from "./extract.ts"

/**
 * Recursive, token-aware chunking (CONTEXT §5, ADR-0004). Each chunk targets
 * ~600 tokens with ~80 tokens of overlap so a passage split across a boundary is
 * still retrievable, and carries its `page`, `charOffset` (into that page's
 * text), and a document-wide `chunkIndex`. This is a pure function of its inputs
 * — the bug-prone unit ADR-0012 singles out for direct tests (boundaries,
 * overlap, provenance).
 */
export type Chunk = {
  content: string
  page: number
  charOffset: number
  chunkIndex: number
}

export type ChunkOptions = {
  chunkTokens?: number
  overlapTokens?: number
}

// cl100k_base is the tokenizer for text-embedding-3-small — count against the
// same units the embedder bills, so "~600 tokens" means what it says.
const enc = getEncoding("cl100k_base")
const countTokens = (text: string): number => enc.encode(text).length

// Tried in order: paragraphs, then lines, then sentences, then words. A segment
// that still exceeds the budget after the last separator is hard-split by chars.
const SEPARATORS = ["\n\n", "\n", ". ", " "]

/** A contiguous slice of a page's text with its offset and token count. */
type Atom = { start: number; end: number; tokens: number }

/**
 * Split a document's pages into overlapping chunks in reading order.
 * `chunkIndex` is monotonic across the whole document (not reset per page), so it
 * uniquely orders chunks and satisfies `UNIQUE(document_id, chunk_index)`.
 */
export function chunkPages(
  pages: ExtractedPage[],
  options: ChunkOptions = {},
): Chunk[] {
  const chunkTokens = options.chunkTokens ?? 600
  const overlapTokens = options.overlapTokens ?? 80
  const chunks: Chunk[] = []
  let chunkIndex = 0

  for (const { page, text } of pages) {
    if (text.trim() === "") continue
    const atoms = atomize(text, 0, 0, chunkTokens)
    for (const { start, end } of packAtoms(atoms, chunkTokens, overlapTokens)) {
      const content = text.slice(start, end)
      if (content.trim() === "") continue
      chunks.push({ content, page, charOffset: start, chunkIndex: chunkIndex++ })
    }
  }

  return chunks
}

/**
 * Recursively break `text` (at `base` offset in its page) into atoms that each
 * fit `maxTokens`, trying successively finer separators. Atoms fully cover the
 * text with no gaps — each piece keeps its trailing separator — so a packed
 * chunk is always a single contiguous `slice`.
 */
function atomize(
  text: string,
  base: number,
  sepIndex: number,
  maxTokens: number,
): Atom[] {
  const tokens = countTokens(text)
  if (tokens <= maxTokens) {
    return text.length === 0 ? [] : [{ start: base, end: base + text.length, tokens }]
  }
  const separator = SEPARATORS[sepIndex]
  if (separator === undefined) return hardSplit(text, base, maxTokens)

  const atoms: Atom[] = []
  for (const piece of splitKeepingSeparator(text, separator)) {
    atoms.push(...atomize(piece.text, base + piece.offset, sepIndex + 1, maxTokens))
  }
  return atoms
}

/** Last-resort split of an unbreakable run (e.g. one giant token-dense word). */
function hardSplit(text: string, base: number, maxTokens: number): Atom[] {
  // ~4 chars/token is a safe over-estimate; keeps each slice under the budget.
  const window = Math.max(1, maxTokens * 4)
  const atoms: Atom[] = []
  for (let i = 0; i < text.length; i += window) {
    const slice = text.slice(i, i + window)
    atoms.push({ start: base + i, end: base + i + slice.length, tokens: countTokens(slice) })
  }
  return atoms
}

/**
 * Split on `sep` while preserving offsets and full coverage: every piece keeps
 * its trailing separator, so concatenating the pieces reproduces the input.
 */
function splitKeepingSeparator(
  text: string,
  sep: string,
): { text: string; offset: number }[] {
  const parts = text.split(sep)
  const out: { text: string; offset: number }[] = []
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ""
    const withSep = i < parts.length - 1 ? part + sep : part
    if (withSep.length > 0) out.push({ text: withSep, offset: pos })
    pos += withSep.length
  }
  return out
}

/**
 * Greedily pack atoms into chunks up to `chunkTokens`, then seed the next chunk
 * with the trailing atoms of the last (up to `overlapTokens`). Because overlap
 * atoms immediately precede the atoms that follow, every emitted chunk spans a
 * single contiguous `[start, end)`.
 */
function packAtoms(
  atoms: Atom[],
  chunkTokens: number,
  overlapTokens: number,
): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = []
  let current: Atom[] = []
  let currentTokens = 0

  const emit = () => {
    const first = current[0]
    const last = current[current.length - 1]
    if (!first || !last) return
    chunks.push({ start: first.start, end: last.end })
  }

  for (const atom of atoms) {
    if (current.length > 0 && currentTokens + atom.tokens > chunkTokens) {
      emit()
      const overlap = trailingOverlap(current, overlapTokens)
      current = [...overlap]
      currentTokens = overlap.reduce((n, a) => n + a.tokens, 0)
    }
    current.push(atom)
    currentTokens += atom.tokens
  }
  emit()

  return chunks
}

/** Trailing atoms of a chunk whose tokens sum to at most `overlapTokens`. */
function trailingOverlap(atoms: Atom[], overlapTokens: number): Atom[] {
  const overlap: Atom[] = []
  let sum = 0
  for (let i = atoms.length - 1; i >= 0; i--) {
    const atom = atoms[i]
    if (!atom || sum + atom.tokens > overlapTokens) break
    overlap.unshift(atom)
    sum += atom.tokens
  }
  return overlap
}
