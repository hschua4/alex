import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
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
import { DEFAULT_ANSWER_MODEL, rankCandidates } from "../src/chat/index.ts"
import {
  createFakeEmbedder,
  createMemoryStore,
  ingestDocument,
  type Embedder,
  type ObjectStore,
} from "../src/ingest/index.ts"
import { makePdf } from "./fixtures/make-pdf.ts"
import { mockStreamModel } from "./mocks/models.ts"

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

  /** Build the API with a given answer text the mock model will stream back. */
  function makeApi(answerText: string) {
    return createApi({
      db,
      auth: fakeAuth(user),
      store,
      enqueueIngest: async () => {},
      embedder,
      answerModel: () => mockStreamModel(answerText),
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
})
