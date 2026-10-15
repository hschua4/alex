import { describe, expect, it } from "vitest"

import type { Database } from "@alex/db"

import { createApi, type ApiDeps, type SessionUser } from "../src/app.ts"
import type { Auth } from "../src/auth.ts"
import {
  createPassthroughCondenser,
  DEFAULT_ANSWER_MODEL,
} from "../src/chat/index.ts"
import { createFakeEmbedder, createMemoryStore } from "../src/ingest/index.ts"
import { createRateLimiter } from "../src/rate-limit.ts"
import { mockStreamModel } from "./mocks/models.ts"

/**
 * Chat route behavior that needs no database: the auth guard, and the two
 * request rejections that must fire *before* any DB work — a 0-document turn
 * (ADR-0003) and an off-allowlist model (ADR-0010). Retrieval, streaming, and
 * persistence are proven against real Postgres in `chat.integration.test.ts`.
 */
function fakeAuth(session: { user: SessionUser } | null): Auth {
  return {
    handler: async () => new Response("{}"),
    api: { getSession: async () => session },
  } as unknown as Auth
}

const user: SessionUser = {
  id: "user_1",
  email: "member@example.com",
  name: "Member",
  image: null,
}

const noDb = {} as Database

function apiWith(
  session: { user: SessionUser } | null,
  extra: Partial<ApiDeps> = {},
) {
  return createApi({
    db: noDb,
    auth: fakeAuth(session),
    store: createMemoryStore(),
    enqueueIngest: async () => {},
    embedder: createFakeEmbedder(),
    answerModel: () => mockStreamModel(),
    condense: createPassthroughCondenser(),
    ...extra,
  })
}

describe("chat routes — guard", () => {
  it("401s every chat route when unauthenticated", async () => {
    const api = apiWith(null)

    expect((await api.request("/chat/models")).status).toBe(401)
    expect(
      (await api.request("/projects/p1/chat/sessions")).status,
    ).toBe(401)
    expect(
      (await api.request("/projects/p1/chat/sessions/s1/messages")).status,
    ).toBe(401)
    const post = await api.request("/projects/p1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "hi",
        selectedDocumentIds: ["d1"],
        model: DEFAULT_ANSWER_MODEL,
      }),
    })
    expect(post.status).toBe(401)
  })
})

describe("chat routes — request validation (pre-DB)", () => {
  it("exposes the answer-model allowlist and default", async () => {
    const res = await apiWith({ user }).request("/chat/models")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      models: { id: string; label: string }[]
      default: string
    }
    expect(body.default).toBe(DEFAULT_ANSWER_MODEL)
    expect(body.models.map((m) => m.id)).toContain(DEFAULT_ANSWER_MODEL)
  })

  it("rejects a turn with zero selected documents", async () => {
    const res = await apiWith({ user }).request("/projects/p1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "What does the doc say?",
        selectedDocumentIds: [],
        model: DEFAULT_ANSWER_MODEL,
      }),
    })
    expect(res.status).toBe(400)
  })

  it("rejects a model that is not on the server allowlist", async () => {
    const res = await apiWith({ user }).request("/projects/p1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "What does the doc say?",
        selectedDocumentIds: ["d1"],
        model: "openai/o1-super-expensive",
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe("chat routes — per-user rate limit (ADR-0011)", () => {
  const exhausted = () => createRateLimiter({ limit: 0, windowMs: 60_000 })
  const turn = {
    content: "hi",
    selectedDocumentIds: ["d1"],
    model: DEFAULT_ANSWER_MODEL,
  }

  it("429s with Retry-After once the user's budget is spent", async () => {
    const res = await apiWith({ user }, { chatLimiter: exhausted() }).request(
      "/projects/p1/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(turn),
      },
    )
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("60")
  })

  it("throttles regenerate too — it's a model call", async () => {
    const res = await apiWith({ user }, { chatLimiter: exhausted() }).request(
      "/projects/p1/chat/messages/m1/regenerate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: DEFAULT_ANSWER_MODEL }),
      },
    )
    expect(res.status).toBe(429)
  })

  it("invalid requests don't spend budget — validation runs first", async () => {
    const res = await apiWith({ user }, { chatLimiter: exhausted() }).request(
      "/projects/p1/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...turn, selectedDocumentIds: [] }),
      },
    )
    expect(res.status).toBe(400)
  })
})
