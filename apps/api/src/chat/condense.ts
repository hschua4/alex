import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"

/**
 * Follow-up condensing (CONTEXT §4.3, ADR-0010). A question like "what about its
 * pricing?" only makes sense against the turns before it — embedded verbatim it
 * retrieves nothing useful. So for a *follow-up* we rewrite it into a standalone
 * query using the recent history, then retrieve on that. The **first** message of
 * a session skips this: it is already standalone, and calling the condenser would
 * be a wasted round-trip.
 *
 * The condensing model is pinned to `gpt-4o-mini` (env-configurable) and is
 * **never** user-selectable — the picker swaps only the answer model. Reaching it
 * is injected so tests substitute a deterministic fake, and a live failure or an
 * empty rewrite falls back to the raw question rather than breaking the turn.
 */

/** The pinned condensing model; overridable via `CONDENSE_MODEL` (CONTEXT §7). */
export const DEFAULT_CONDENSE_MODEL = "openai/gpt-4o-mini"

/** How many prior turns of context the rewrite gets (CONTEXT §4.3, "last ~6"). */
export const CONDENSE_HISTORY_TURNS = 6

/** A prior turn, reduced to what the rewrite needs. */
export type CondenseTurn = { role: "user" | "assistant"; content: string }

export type Condenser = {
  /**
   * Rewrite `question` into a standalone query given the recent `history`
   * (most-recent-last). Callers pass history only for follow-ups; an empty
   * history returns the question unchanged.
   */
  condense(input: {
    question: string
    history: CondenseTurn[]
  }): Promise<string>
}

const CONDENSE_SYSTEM = `You rewrite a user's latest message into a standalone search query for a document retrieval system.

Rules:
- Resolve pronouns and references ("it", "that", "the previous one") using the conversation so the query stands alone.
- Keep it a terse, keyword-rich query — not a full sentence, no answer, no preamble.
- If the message is already self-contained, return it essentially unchanged.
- Output ONLY the rewritten query, nothing else.`

/** Render the recent turns as a compact transcript for the rewrite prompt. */
function formatHistory(history: CondenseTurn[]): string {
  return history
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n")
}

export type CondenserEnv = {
  apiKey: string
  baseURL?: string
  model?: string
}

/**
 * Real condenser over the OpenRouter-compatible endpoint (CONTEXT §7). A single
 * short `generateText` call at temperature 0 for a stable rewrite; any error or an
 * empty result falls back to the original question so a flaky condense never sinks
 * the answer turn.
 */
export function createOpenRouterCondenser(env: CondenserEnv): Condenser {
  const provider = createOpenAI({ apiKey: env.apiKey, baseURL: env.baseURL })
  const model = provider.chat(env.model ?? DEFAULT_CONDENSE_MODEL)
  return {
    async condense({ question, history }) {
      if (history.length === 0) return question
      try {
        const { text } = await generateText({
          model,
          temperature: 0,
          system: CONDENSE_SYSTEM,
          prompt: `Conversation so far:\n${formatHistory(history)}\n\nLatest message: ${question}\n\nStandalone query:`,
        })
        const rewritten = text.trim()
        return rewritten.length > 0 ? rewritten : question
      } catch {
        // Condensing is a retrieval nicety, not a correctness gate — fall back.
        return question
      }
    },
  }
}

/**
 * A no-op condenser that returns the question verbatim. Used as the injectable
 * default in tests where condensing is irrelevant; the route still gates it to
 * follow-ups, so this is never called on a first turn.
 */
export function createPassthroughCondenser(): Condenser {
  return { condense: async ({ question }) => question }
}
