import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { LanguageModel } from "ai"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  chunk,
  createDb,
  createProject,
  listMessages,
  markProcessing,
  retrieveCandidates,
  type Database,
} from "@alex/db"

import { createApi, type SessionUser } from "../src/app.ts"
import type { Auth } from "../src/auth.ts"
import {
  createPassthroughCondenser,
  DEFAULT_ANSWER_MODEL,
  rankCandidates,
  type Condenser,
} from "../src/chat/index.ts"
import {
  createFakeEmbedder,
  createMemoryStore,
  ingestDocument,
  type Embedder,
  type ObjectStore,
} from "../src/ingest/index.ts"
import { makePdf } from "./fixtures/make-pdf.ts"
import { mockBrokenStreamModel, mockStreamModel } from "./mocks/models.ts"

/**
 * The grounded-chat path against real pgvector (ADR-0012): the retrieval filter
 * (status-gating + selected-set), and the full turn end-to-end — persist user
 * turn, retrieve, stream, finalize the assistant message with validated
 * citations, model, and usage. The answer model is mocked (`mockStreamModel`) and
 * embeddings are the deterministic fake, so no real model call runs.
 */
const IMAGE = "pgvector/pgvector:pg16"
const migrationsFolder = fileURLToPath(
  new URL("../../../packages/db/drizzle", import.meta.url),
)

function fakeAuth(user: SessionUser): Auth {
  return {
    handler: async () => new Response("{}"),
    api: { getSession: async () => ({ user }) },
  } as unknown as Auth
}

const embedder: Embedder = createFakeEmbedder()

type SSEEvent = { event: string; data: Record<string, unknown> }

/** Parse an `event:`/`data:` SSE payload into its events. */
function parseSSE(raw: string): SSEEvent[] {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = /^event:\s*(.+)$/m.exec(block)?.[1] ?? "message"
      const data = /^data:\s*(.+)$/m.exec(block)?.[1] ?? "{}"
      return { event, data: JSON.parse(data) as Record<string, unknown> }
    })
}

describe("grounded chat (real pgvector)", () => {
  let container: StartedPostgreSqlContainer
  let db: Database
  let close: () => Promise<void>

  const user: SessionUser = {
    id: `user_${randomUUID()}`,
    email: "member@example.com",
    name: "Member",
    image: null,
  }

  let store: ObjectStore
  let projectId: string

  /**
   * Build the API with a given answer text the mock model will stream back.
   * `opts` swaps in a broken-stream model (stopped path) or a spy condenser
   * (follow-up condensing) for the tests that need them.
   */
  function makeApi(
    answerText: string,
    opts: {
      answerModel?: () => LanguageModel
      condense?: Condenser
    } = {},
  ) {
    return createApi({
      db,
      auth: fakeAuth(user),
      store,
      enqueueIngest: async () => {},
      embedder,
      answerModel: opts.answerModel ?? (() => mockStreamModel(answerText)),
      condense: opts.condense ?? createPassthroughCondenser(),
    })
  }

  /** Upload + ingest a PDF; return the document id (status ends `indexed`). */
  async function ingest(
    api: ReturnType<typeof createApi>,
    pages: string[],
    name: string,
  ): Promise<string> {
    const pdf = await makePdf(pages)
    const form = new FormData()
    form.append("file", new File([pdf], name, { type: "application/pdf" }))
    const res = await api.request(`/projects/${projectId}/documents`, {
      method: "POST",
      body: form,
    })
    const { document } = (await res.json()) as { document: { id: string } }
    await ingestDocument({ db, store, embedder }, document.id)
    return document.id
  }

  async function firstChunkContent(documentId: string): Promise<string> {
    const rows = await db
      .select()
      .from(chunk)
      .where(eq(chunk.documentId, documentId))
    return rows[0]!.content
  }

  async function chatRequest(
    api: ReturnType<typeof createApi>,
    body: unknown,
  ): Promise<SSEEvent[]> {
    const res = await api.request(`/projects/${projectId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
    return parseSSE(await res.text())
  }

  async function regenerateRequest(
    api: ReturnType<typeof createApi>,
    messageId: string,
    model: string,
  ): Promise<SSEEvent[]> {
    const res = await api.request(
      `/projects/${projectId}/chat/messages/${messageId}/regenerate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
      },
    )
    expect(res.status).toBe(200)
    return parseSSE(await res.text())
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer(IMAGE).start()
    const conn = createDb(container.getConnectionUri(), 1)
    db = conn.db
    close = conn.close
    await migrate(db, { migrationsFolder })
  }, 180_000)

  afterAll(async () => {
    await close?.()
    await container?.stop()
  })

  beforeEach(async () => {
    store = createMemoryStore()
    const project = await createProject(db, { userId: user.id, name: "Docs" })
    projectId = project.id
  })

  it("retrieval sees only indexed docs within the selected set", async () => {
    const api = makeApi("noop")
    const indexed = await ingest(
      api,
      ["The mitochondria is the powerhouse of the cell and makes ATP."],
      "indexed.pdf",
    )
    // Same content, but flipped back to processing after ingest: has chunks, but
    // must be excluded from retrieval (status-gating).
    const processing = await ingest(
      api,
      ["Chlorophyll absorbs light for photosynthesis in the chloroplast."],
      "processing.pdf",
    )
    await markProcessing(db, processing)
    // An indexed doc that is NOT selected — must be excluded by the selected-set.
    const unselected = await ingest(
      api,
      ["Ribosomes translate messenger RNA into proteins."],
      "unselected.pdf",
    )

    const query = await firstChunkContent(indexed)
    const [queryEmbedding] = await embedder.embed([query])
    const candidates = await retrieveCandidates(db, {
      userId: user.id,
      documentIds: [indexed, processing], // unselected deliberately omitted
      queryEmbedding: queryEmbedding!,
      limit: 40,
    })

    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every((c) => c.documentId === indexed)).toBe(true)
    expect(candidates.some((c) => c.documentId === processing)).toBe(false)
    expect(candidates.some((c) => c.documentId === unselected)).toBe(false)

    const ranked = rankCandidates(candidates)
    expect(ranked[0]?.similarity).toBeCloseTo(1, 4)
  })

  it("streams a grounded answer and finalizes the assistant turn", async () => {
    const api = makeApi("MMLU covers 57 subjects [1].")
    const docId = await ingest(
      api,
      ["MMLU comprises 57 subjects scored as multiple-choice accuracy."],
      "mmlu.pdf",
    )
    const question = await firstChunkContent(docId)

    const events = await chatRequest(api, {
      content: question,
      selectedDocumentIds: [docId],
      model: DEFAULT_ANSWER_MODEL,
    })

    const start = events.find((e) => e.event === "start")
    const deltas = events.filter((e) => e.event === "delta")
    const done = events.find((e) => e.event === "done")

    expect(start?.data.sessionId).toBeTruthy()
    expect(deltas.length).toBeGreaterThan(0)
    expect((deltas.map((d) => d.data.text).join(""))).toBe(
      "MMLU covers 57 subjects [1].",
    )
    expect(done?.data.status).toBe("complete")
    const doneCitations = done?.data.citations as { n: number }[]
    expect(doneCitations.map((c) => c.n)).toEqual([1])

    // Persisted: user turn first (with its selection), then the finalized answer.
    const sessionId = start!.data.sessionId as string
    const messages = await listMessages(db, user.id, sessionId)
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"])

    const [userMsg, assistant] = messages
    expect(userMsg!.content).toBe(question)
    expect(userMsg!.selectedDocumentIds).toEqual([docId])

    expect(assistant!.content).toBe("MMLU covers 57 subjects [1].")
    expect(assistant!.status).toBe("complete")
    expect(assistant!.modelId).toBe(DEFAULT_ANSWER_MODEL)
    expect(assistant!.tokenUsage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    })
    expect(assistant!.citations).toHaveLength(1)
    expect(assistant!.citations[0]).toMatchObject({
      n: 1,
      documentId: docId,
      documentName: "mmlu.pdf",
    })
  })

  it("drops invalid [n] markers when finalizing citations", async () => {
    // The model cites a real [1] and an invented [9]; only [1] must survive.
    const api = makeApi("Grounded claim [1] and a fabricated one [9].")
    const docId = await ingest(
      api,
      ["HELM measures models across seven metrics over many scenarios."],
      "helm.pdf",
    )
    const question = await firstChunkContent(docId)

    const events = await chatRequest(api, {
      content: question,
      selectedDocumentIds: [docId],
      model: DEFAULT_ANSWER_MODEL,
    })

    const done = events.find((e) => e.event === "done")
    expect((done?.data.citations as { n: number }[]).map((c) => c.n)).toEqual([
      1,
    ])

    const sessionId = (events.find((e) => e.event === "start")!.data
      .sessionId) as string
    const messages = await listMessages(db, user.id, sessionId)
    const assistant = messages[1]!
    expect(assistant.citations.map((c) => c.n)).toEqual([1])
  })

  it("continues an existing session on a second turn", async () => {
    const api = makeApi("First answer [1].")
    const docId = await ingest(
      api,
      ["A single page of retrievable content about widgets."],
      "widgets.pdf",
    )
    const question = await firstChunkContent(docId)

    const first = await chatRequest(api, {
      content: question,
      selectedDocumentIds: [docId],
      model: DEFAULT_ANSWER_MODEL,
    })
    const sessionId = first.find((e) => e.event === "start")!.data
      .sessionId as string

    const second = await chatRequest(api, {
      sessionId,
      content: question,
      selectedDocumentIds: [docId],
      model: DEFAULT_ANSWER_MODEL,
    })
    expect(second.find((e) => e.event === "start")!.data.sessionId).toBe(
      sessionId,
    )

    const messages = await listMessages(db, user.id, sessionId)
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ])
  })

  it("condenses a follow-up but not the first turn (CONTEXT §4.3)", async () => {
    const calls: { question: string; history: { role: string }[] }[] = []
    const condense: Condenser = {
      condense: async (input) => {
        calls.push(input)
        return input.question
      },
    }
    const api = makeApi("An answer [1].", { condense })
    const docId = await ingest(
      api,
      ["Widget pricing details and product specifications."],
      "widget.pdf",
    )
    const firstQuestion = await firstChunkContent(docId)

    const first = await chatRequest(api, {
      content: firstQuestion,
      selectedDocumentIds: [docId],
      model: DEFAULT_ANSWER_MODEL,
    })
    const sessionId = first.find((e) => e.event === "start")!.data
      .sessionId as string
    // The first message is already standalone — the condenser is never called.
    expect(calls).toHaveLength(0)

    await chatRequest(api, {
      sessionId,
      content: "what about its pricing?",
      selectedDocumentIds: [docId],
      model: DEFAULT_ANSWER_MODEL,
    })
    // The follow-up is condensed, with the prior user+assistant turns as context.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.question).toBe("what about its pricing?")
    expect(calls[0]!.history.map((h) => h.role)).toEqual(["user", "assistant"])
  })

  it("scopes each turn's retrieval to that turn's selected set (ADR-0003)", async () => {
    const api = makeApi("Grounded [1].")
    const docA = await ingest(
      api,
      ["Alpha paper: chlorophyll drives photosynthesis in green plants."],
      "alpha.pdf",
    )
    const docB = await ingest(
      api,
      ["Beta paper: quantum entanglement links distant particles in physics."],
      "beta.pdf",
    )
    const qA = await firstChunkContent(docA)
    const qB = await firstChunkContent(docB)

    // Turn 1 selects only A.
    const first = await chatRequest(api, {
      content: qA,
      selectedDocumentIds: [docA],
      model: DEFAULT_ANSWER_MODEL,
    })
    const sessionId = first.find((e) => e.event === "start")!.data
      .sessionId as string
    const firstCites = first.find((e) => e.event === "done")!.data
      .citations as { documentId: string }[]
    expect(firstCites.every((c) => c.documentId === docA)).toBe(true)

    // Turn 2 changes the scope to only B and asks about B.
    const second = await chatRequest(api, {
      sessionId,
      content: qB,
      selectedDocumentIds: [docB],
      model: DEFAULT_ANSWER_MODEL,
    })
    const secondCites = second.find((e) => e.event === "done")!.data
      .citations as { documentId: string }[]
    expect(secondCites.length).toBeGreaterThan(0)
    expect(secondCites.every((c) => c.documentId === docB)).toBe(true)

    // The second user turn records its own selection.
    const messages = await listMessages(db, user.id, sessionId)
    expect(messages[2]!.selectedDocumentIds).toEqual([docB])
  })

  it("keeps a cancelled stream as a stopped partial (CONTEXT §4.6)", async () => {
    const api = makeApi("noop", {
      answerModel: () => mockBrokenStreamModel("Half of an ans"),
    })
    const docId = await ingest(
      api,
      ["Retrievable content about steam turbine efficiency."],
      "turbine.pdf",
    )
    const question = await firstChunkContent(docId)

    const events = await chatRequest(api, {
      content: question,
      selectedDocumentIds: [docId],
      model: DEFAULT_ANSWER_MODEL,
    })
    expect(events.find((e) => e.event === "done")!.data.status).toBe("stopped")

    const sessionId = events.find((e) => e.event === "start")!.data
      .sessionId as string
    const assistant = (await listMessages(db, user.id, sessionId))[1]!
    expect(assistant.status).toBe("stopped")
    expect(assistant.content).toBe("Half of an ans")
  })

  it("regenerate adds a linked answer without destroying the original", async () => {
    const api = makeApi("Original answer [1].")
    const docId = await ingest(
      api,
      ["Content describing the standalone widget specification."],
      "spec.pdf",
    )
    const question = await firstChunkContent(docId)

    const first = await chatRequest(api, {
      content: question,
      selectedDocumentIds: [docId],
      model: DEFAULT_ANSWER_MODEL,
    })
    const sessionId = first.find((e) => e.event === "start")!.data
      .sessionId as string
    const original = (await listMessages(db, user.id, sessionId))[1]!
    expect(original.role).toBe("assistant")

    // Regenerate the answer, switching to another allowlisted model.
    const events = await regenerateRequest(
      api,
      original.id,
      "anthropic/claude-haiku-4.5",
    )
    expect(events.find((e) => e.event === "done")!.data.regeneratedFrom).toBe(
      original.id,
    )

    const messages = await listMessages(db, user.id, sessionId)
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ])
    const [, a1, a2] = messages
    // The original survives untouched; the re-answer links back to it.
    expect(a1!.id).toBe(original.id)
    expect(a1!.regeneratedFrom).toBeNull()
    expect(a2!.regeneratedFrom).toBe(original.id)
    expect(a2!.modelId).toBe("anthropic/claude-haiku-4.5")
  })

  it("404s regenerate for a non-existent message", async () => {
    const api = makeApi("noop")
    const res = await api.request(
      `/projects/${projectId}/chat/messages/${randomUUID()}/regenerate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: DEFAULT_ANSWER_MODEL }),
      },
    )
    expect(res.status).toBe(404)
  })
})
