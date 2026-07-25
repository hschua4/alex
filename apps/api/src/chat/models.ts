import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"

/**
 * Answer-model allowlist and provider (ADR-0010). The answer model is
 * user-selectable *per message* but only from this server-owned list — a
 * client-supplied model id is a direct cost/abuse vector, so the chat route
 * validates every requested id against {@link ANSWER_MODEL_IDS} and rejects
 * anything else. Adding or removing a model is a change here; the client just
 * fetches and follows.
 *
 * Condensing (`gpt-4o-mini`) and embeddings (`text-embedding-3-small`) are pinned
 * elsewhere and are never user-selectable.
 */

export type AnswerModel = { id: string; label: string }

/** The models the picker may offer. All routed via OpenRouter (CONTEXT §7). */
export const ANSWER_MODELS: readonly AnswerModel[] = [
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
]

/** The default answer model, pre-selected until the user picks another. */
export const DEFAULT_ANSWER_MODEL = "anthropic/claude-sonnet-5"

/** The allowed ids, for the route's server-side validation. */
export const ANSWER_MODEL_IDS = ANSWER_MODELS.map((m) => m.id)

/** Whether `id` is on the server allowlist (ADR-0010). */
export function isAllowedModel(id: string): id is string {
  return ANSWER_MODEL_IDS.includes(id)
}

export type AnswerModelEnv = {
  apiKey: string
  baseURL?: string
}

/**
 * Build the answer-model factory the chat route injects: id → a `LanguageModel`
 * over the OpenRouter-compatible endpoint. The id is validated against the
 * allowlist *before* this is called. Tests inject a fake factory returning a
 * `MockLanguageModelV2`, so no real model call runs in CI (ADR-0012).
 */
export function createOpenRouterAnswerModel(
  env: AnswerModelEnv,
): (modelId: string) => LanguageModel {
  const provider = createOpenAI({ apiKey: env.apiKey, baseURL: env.baseURL })
  return (modelId: string) => provider.chat(modelId)
}
