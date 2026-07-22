import { simulateReadableStream } from "ai"
import { MockLanguageModelV2 } from "ai/test"

/**
 * Model mocking harness for the CI gate (ADR-0012). No real LLM or embedding
 * call ever runs in tests — chat uses `MockLanguageModelV2`, retrieval uses the
 * deterministic fake embeddings below.
 */

/** A stub answer model that always returns the same text via `doGenerate`. */
export function mockAnswerModel(text = "Mock grounded answer [1].") {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      content: [{ type: "text", text }],
      warnings: [],
    }),
  })
}

/**
 * A streaming stub answer model for `streamText`: emits `text` split into a few
 * deltas, then a `finish` with a fixed token usage. The chat route consumes the
 * `textStream`, so the model must implement `doStream` (not just `doGenerate`).
 */
export function mockStreamModel(text = "Mock grounded answer [1].") {
  // Split into a handful of deltas so the stream is exercised, not one lump.
  const parts = text.match(/.{1,12}/gs) ?? [text]
  return new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "0" },
          ...parts.map((delta) => ({
            type: "text-delta" as const,
            id: "0",
            delta,
          })),
          { type: "text-end", id: "0" },
          {
            type: "finish" as const,
            finishReason: "stop" as const,
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          },
        ],
      }),
    }),
  })
}

/**
 * Deterministic 1536-d fake embedding. Same text always maps to the same
 * vector, distinct texts to distinguishable ones — enough to exercise cosine
 * ordering without a real embedding model.
 */
export function fakeEmbed(text: string, dims = 1536): number[] {
  const vec = new Array<number>(dims)
  let seed = 2166136261
  for (let i = 0; i < text.length; i++) {
    seed ^= text.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  for (let i = 0; i < dims; i++) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519)
    seed = (seed ^ (seed >>> 13)) >>> 0
    vec[i] = (seed / 0xffffffff) * 2 - 1
  }
  return vec
}
