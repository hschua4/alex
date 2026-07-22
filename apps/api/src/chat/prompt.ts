import type { RetrievedChunk } from "./retrieval.ts"

/**
 * Prompt assembly for grounded answers (ADR-0005). Retrieved chunks are fed
 * *pre-numbered* into the context and the model is instructed to cite claims with
 * `[n]` matching those numbers. The numbers are validated after generation
 * (`citations.ts`) — the model's citation is prompted for, then checked, never
 * trusted blindly.
 */

export const SYSTEM_PROMPT = `You are Alex, a careful research assistant. Answer the user's question using ONLY the numbered source passages provided. Do not use outside knowledge.

Rules:
- Cite every claim with the bracketed number of the passage it comes from, e.g. "MMLU covers 57 subjects [1]." Place the marker at the end of the sentence or clause it supports.
- You may cite more than one passage for a claim, e.g. "[2][4]".
- Only cite passages that are actually provided; never invent a number.
- If the passages do not contain the answer, say so plainly instead of guessing. Do not fabricate sources.
- Be concise and factual. Prefer short paragraphs.`

/** A truncated preview of a chunk for the prompt context (keeps the body lean). */
const CONTEXT_CHAR_LIMIT = 1200

/**
 * Build the user prompt: the numbered source passages followed by the question.
 * Each passage is labelled with its number, source document, and page so the
 * model can attribute precisely.
 */
export function buildPrompt(question: string, chunks: RetrievedChunk[]): string {
  const sources = chunks
    .map((c) => {
      const body = c.content.slice(0, CONTEXT_CHAR_LIMIT)
      return `[${c.n}] (${c.documentName}, p. ${c.page})\n${body}`
    })
    .join("\n\n")

  return `Source passages:\n\n${sources}\n\n---\n\nQuestion: ${question}`
}
