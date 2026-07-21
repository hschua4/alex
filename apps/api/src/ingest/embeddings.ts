import { createOpenAI } from "@ai-sdk/openai"
import { embedMany, type EmbeddingModel } from "ai"

/**
 * Text → 1536-d embeddings (CONTEXT §7). The model is pinned — changing it
 * invalidates the entire index — but *how* we reach it is injected so tests can
 * substitute deterministic fake vectors (ADR-0012): no real embedding call ever
 * runs in CI, and the fake is a pure function of text so a chunk embedded as a
 * query lands cosine-1 on itself.
 */
export type Embedder = {
  /** Embed `texts` in order; returns one 1536-d vector per input. */
  embed(texts: string[]): Promise<number[][]>
}

/** 1536, the dimensionality of `text-embedding-3-small` — never changes. */
export const EMBEDDING_DIMENSIONS = 1536

/** Chunks per embedding round-trip (ADR-0006): cut round-trips without a huge body. */
const BATCH_SIZE = 96

export type EmbedderEnv = {
  apiKey: string
  baseURL?: string
  model?: string
}

/**
 * Real embedder over an OpenAI-compatible endpoint (OpenRouter in prod, per
 * CONTEXT §7; `baseURL` lets it point straight at OpenAI too). Batches at
 * {@link BATCH_SIZE} so a large document is a handful of calls, not hundreds; a
 * failed batch just fails the job, which retries cleanly (ADR-0006).
 */
export function createOpenAIEmbedder(env: EmbedderEnv): Embedder {
  const provider = createOpenAI({ apiKey: env.apiKey, baseURL: env.baseURL })
  const model: EmbeddingModel<string> = provider.embedding(
    env.model ?? "text-embedding-3-small",
  )
  return {
    async embed(texts) {
      const out: number[][] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE)
        const { embeddings } = await embedMany({ model, values: batch })
        out.push(...embeddings)
      }
      return out
    },
  }
}

/**
 * Deterministic fake embedder for tests: a normalized 1536-d vector seeded from
 * the text alone (a tiny xorshift PRNG). Same text → same vector, so retrieval
 * assertions are exact without a real model or network.
 */
export function createFakeEmbedder(): Embedder {
  return {
    async embed(texts) {
      return texts.map(fakeVector)
    },
  }
}

function fakeVector(text: string): number[] {
  let seed = 2166136261 >>> 0
  for (let i = 0; i < text.length; i++) {
    seed = Math.imul(seed ^ text.charCodeAt(i), 16777619) >>> 0
  }
  const v = new Array<number>(EMBEDDING_DIMENSIONS)
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    // xorshift32 step
    seed ^= seed << 13
    seed >>>= 0
    seed ^= seed >> 17
    seed ^= seed << 5
    seed >>>= 0
    const x = (seed / 0xffffffff) * 2 - 1
    v[i] = x
    norm += x * x
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) v[i] = (v[i] as number) / norm
  return v
}
