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
  getDocument,
  listDocuments,
  markFailed,
  searchChunks,
  type Database,
} from "@alex/db"

import { createApi, type SessionUser } from "../src/app.ts"
import type { Auth } from "../src/auth.ts"
import {
  createFakeEmbedder,
  createMemoryStore,
  errorMessageOf,
  ingestDocument,
  type ObjectStore,
} from "../src/ingest/index.ts"
import { makeBlankPdf, makePdf } from "./fixtures/make-pdf.ts"

/**
 * The ingestion path against real pgvector (ADR-0012): the pieces that can't be
 * mocked meaningfully — the vector column + HNSW index, `UNIQUE(document_id,
 * chunk_index)`, delete-then-insert idempotency, and `status`-gated retrieval.
 * Runs the boundary caps through the real route and the extract → chunk → embed
 * → index pipeline through the real worker function, with a fake embedder.
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

const embedder = createFakeEmbedder()

async function uploadFile(
  api: ReturnType<typeof createApi>,
  projectId: string,
  file: File,
) {
  const form = new FormData()
  form.append("file", file)
  return api.request(`/projects/${projectId}/documents`, {
    method: "POST",
    body: form,
  })
}

describe("ingestion (real pgvector)", () => {
  let container: StartedPostgreSqlContainer
  let db: Database
  let close: () => Promise<void>

  const user: SessionUser = {
    id: `user_${randomUUID()}`,
    email: "member@example.com",
    name: "Member",
    image: null,
  }

  let store: ObjectStore & { size: () => number }
  let enqueued: string[]
  let api: ReturnType<typeof createApi>
  let projectId: string

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
    enqueued = []
    api = createApi({
      db,
      auth: fakeAuth(user),
      store,
      enqueueIngest: async (id) => {
        enqueued.push(id)
      },
    })
    const project = await createProject(db, { userId: user.id, name: "Docs" })
    projectId = project.id
  })

  it("stores the original, creates a processing row, and enqueues", async () => {
    const pdf = await makePdf(["Hello from page one.", "And page two."])
    const res = await uploadFile(api, projectId, new File([pdf], "doc.pdf", { type: "application/pdf" }))

    expect(res.status).toBe(201)
    const { document } = (await res.json()) as { document: { id: string; status: string; pageCount: number } }
    expect(document.status).toBe("processing")
    expect(document.pageCount).toBe(2)
    expect(store.size()).toBe(1)
    expect(enqueued).toEqual([document.id])

    const rows = await listDocuments(db, user.id, projectId)
    expect(rows.map((r) => r.id)).toContain(document.id)
  })

  it("rejects an unsupported file type at the boundary", async () => {
    const res = await uploadFile(api, projectId, new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }))
    expect(res.status).toBe(415)
    expect(store.size()).toBe(0)
    expect(enqueued).toEqual([])
  })

  it("rejects an oversized upload at the boundary", async () => {
    const big = new File([new Uint8Array(21 * 1024 * 1024)], "big.pdf", { type: "application/pdf" })
    const res = await uploadFile(api, projectId, big)
    expect(res.status).toBe(413)
    expect(store.size()).toBe(0)
  })

  it("rejects an over-page PDF at the boundary", async () => {
    const pdf = await makeBlankPdf(301)
    const res = await uploadFile(api, projectId, new File([pdf], "huge.pdf", { type: "application/pdf" }))
    expect(res.status).toBe(413)
    expect(store.size()).toBe(0)
  })

  it("indexes a document: processing → indexed, chunks carry provenance, retrievable", async () => {
    const pdf = await makePdf([
      "The mitochondria is the powerhouse of the cell and produces ATP through respiration.",
      "Chlorophyll absorbs light for photosynthesis in the chloroplast of plant cells.",
    ])
    const res = await uploadFile(api, projectId, new File([pdf], "bio.pdf", { type: "application/pdf" }))
    const { document } = (await res.json()) as { document: { id: string } }

    await ingestDocument({ db, store, embedder }, document.id)

    const doc = await getDocument(db, user.id, document.id)
    expect(doc?.status).toBe("indexed")
    expect(doc?.errorMessage).toBeNull()

    const rows = await db.select().from(chunk).where(eq(chunk.documentId, document.id))
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.embedding).toHaveLength(1536)
      expect([1, 2]).toContain(r.page)
      expect(r.charOffset).toBeGreaterThanOrEqual(0)
    }
    // chunk_index is sequential and unique.
    const indices = rows.map((r) => r.chunkIndex).sort((a, b) => a - b)
    expect(indices).toEqual(indices.map((_, i) => i))

    // Retrievable: embedding a chunk's own text lands it cosine-1 on itself.
    const target = rows[0]!
    const [queryEmbedding] = await embedder.embed([target.content])
    const hits = await searchChunks(db, {
      userId: user.id,
      documentIds: [document.id],
      queryEmbedding: queryEmbedding!,
      k: 5,
    })
    expect(hits[0]?.id).toBe(target.id)
    expect(hits[0]?.similarity).toBeCloseTo(1, 4)
  })

  it("lands failed with an error_message; re-ingest re-enqueues", async () => {
    // A blank PDF extracts no text, so ingestion fails with a clear message.
    const pdf = await makeBlankPdf(2)
    const res = await uploadFile(api, projectId, new File([pdf], "blank.pdf", { type: "application/pdf" }))
    const { document } = (await res.json()) as { document: { id: string } }

    await expect(ingestDocument({ db, store, embedder }, document.id)).rejects.toThrow()
    // The queue's terminal handler records the failure.
    await markFailed(db, document.id, errorMessageOf(new Error("No text could be extracted from the document")))

    const failed = await getDocument(db, user.id, document.id)
    expect(failed?.status).toBe("failed")
    expect(failed?.errorMessage).toContain("No text")

    enqueued = []
    const reingest = await api.request(
      `/projects/${projectId}/documents/${document.id}/reingest`,
      { method: "POST" },
    )
    expect(reingest.status).toBe(200)
    const back = await getDocument(db, user.id, document.id)
    expect(back?.status).toBe("processing")
    expect(back?.errorMessage).toBeNull()
    expect(enqueued).toEqual([document.id])
  })

  it("re-ingest is idempotent — delete-then-insert leaves no duplicate chunks", async () => {
    const pdf = await makePdf([
      "Repeated ingestion must never duplicate chunks under the unique constraint.",
    ])
    const res = await uploadFile(api, projectId, new File([pdf], "idem.pdf", { type: "application/pdf" }))
    const { document } = (await res.json()) as { document: { id: string } }

    await ingestDocument({ db, store, embedder }, document.id)
    const first = await db.select().from(chunk).where(eq(chunk.documentId, document.id))

    await ingestDocument({ db, store, embedder }, document.id)
    const second = await db.select().from(chunk).where(eq(chunk.documentId, document.id))

    expect(second.length).toBe(first.length)
    const doc = await getDocument(db, user.id, document.id)
    expect(doc?.status).toBe("indexed")
  })
})
