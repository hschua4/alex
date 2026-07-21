import { randomUUID } from "node:crypto"

import { and, cosineDistance, count, desc, eq, gt, inArray, sql } from "drizzle-orm"

import type { Database } from "./client.ts"
import { chunk, document, type Chunk, type Document } from "./schema.ts"

/**
 * Document + chunk queries (ADR-0001 tenancy, ADR-0006 ingestion). Like the
 * project helpers, these live in the db package so the query builders and tables
 * come from one drizzle-orm instance. Every document read/mutation is filtered by
 * `userId`: an id alone never authorizes access.
 */

/** A prepared chunk row, minus the ids the writer assigns. */
export type ChunkInput = {
  content: string
  embedding: number[]
  page: number
  charOffset: number
  chunkIndex: number
}

/** Create a document owned by `userId`, born `processing`. Returns the row. */
export async function createDocument(
  db: Database,
  input: {
    projectId: string
    userId: string
    filename: string
    fileType: string
    sizeBytes: number
    pageCount: number
    storageKey: string
  },
): Promise<Document> {
  const [row] = await db
    .insert(document)
    .values({ id: randomUUID(), ...input })
    .returning()
  if (!row) throw new Error("createDocument: insert returned no row")
  return row
}

/** All of a project's documents for `userId`, most-recently-created first. */
export async function listDocuments(
  db: Database,
  userId: string,
  projectId: string,
): Promise<Document[]> {
  return db
    .select()
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.projectId, projectId)))
    .orderBy(desc(document.createdAt))
}

/** A single document, but only if it belongs to `userId`. */
export async function getDocument(
  db: Database,
  userId: string,
  documentId: string,
): Promise<Document | undefined> {
  const [row] = await db
    .select()
    .from(document)
    .where(and(eq(document.id, documentId), eq(document.userId, userId)))
    .limit(1)
  return row
}

/**
 * Fetch a document by id alone, for the ingestion worker (ADR-0006). Unscoped by
 * design: the worker runs a trusted job whose ownership was already verified when
 * it was enqueued. Never call this from a request path — those use `getDocument`.
 */
export async function getDocumentById(
  db: Database,
  documentId: string,
): Promise<Document | undefined> {
  const [row] = await db
    .select()
    .from(document)
    .where(eq(document.id, documentId))
    .limit(1)
  return row
}

/** Delete a document (chunks cascade). Scoped to the owner. */
export async function deleteDocument(
  db: Database,
  userId: string,
  documentId: string,
): Promise<void> {
  await db
    .delete(document)
    .where(and(eq(document.id, documentId), eq(document.userId, userId)))
}

/**
 * Per-project document counts for `userId`, as a `{ projectId: count }` map —
 * the dashboard's `docCount`, derived so it can't drift (CONTEXT §3).
 */
export async function countDocumentsByProject(
  db: Database,
  userId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ projectId: document.projectId, n: count() })
    .from(document)
    .where(eq(document.userId, userId))
    .groupBy(document.projectId)
  return Object.fromEntries(rows.map((r) => [r.projectId, Number(r.n)]))
}

// ── worker write-paths (ADR-0006) ───────────────────────────────────────────
// These are keyed by id alone (not userId): the worker runs a trusted job for a
// document whose ownership was already checked when it was enqueued.

/** Reset a document to `processing` and clear any prior error (re-ingest). */
export async function markProcessing(
  db: Database,
  documentId: string,
): Promise<void> {
  await db
    .update(document)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(eq(document.id, documentId))
}

/** Flip a document to `indexed` — called only after the chunk tx commits. */
export async function markIndexed(
  db: Database,
  documentId: string,
): Promise<void> {
  await db
    .update(document)
    .set({ status: "indexed", errorMessage: null, updatedAt: new Date() })
    .where(eq(document.id, documentId))
}

/** Land a document in `failed` with a surfaced message (retries exhausted). */
export async function markFailed(
  db: Database,
  documentId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(document)
    .set({ status: "failed", errorMessage, updatedAt: new Date() })
    .where(eq(document.id, documentId))
}

/**
 * Idempotent chunk write (ADR-0006): in one transaction, delete the document's
 * existing chunks and insert the fresh set. Re-running an ingestion — a retry or
 * an explicit re-ingest — can never leave duplicates or a half-indexed doc;
 * `UNIQUE(document_id, chunk_index)` is the backstop.
 */
export async function replaceDocumentChunks(
  db: Database,
  documentId: string,
  chunks: ChunkInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(chunk).where(eq(chunk.documentId, documentId))
    if (chunks.length === 0) return
    await tx.insert(chunk).values(
      chunks.map((c) => ({
        id: randomUUID(),
        documentId,
        content: c.content,
        embedding: c.embedding,
        page: c.page,
        charOffset: c.charOffset,
        chunkIndex: c.chunkIndex,
      })),
    )
  })
}

/** A retrieved chunk with its cosine similarity, joined to its document. */
export type ChunkHit = Chunk & { similarity: number }

/**
 * Cosine top-k over the HNSW index, filtered to the owner's `indexed` documents
 * in the given set (CONTEXT §4, ADR-0004). This is the thin retrieval primitive
 * the ingestion integration test asserts retrievability with; the full retrieval
 * flow (per-doc cap, similarity floor, condensing) lands in the chat slice.
 */
export async function searchChunks(
  db: Database,
  input: {
    userId: string
    documentIds: string[]
    queryEmbedding: number[]
    k?: number
  },
): Promise<ChunkHit[]> {
  if (input.documentIds.length === 0) return []
  const similarity = sql<number>`1 - (${cosineDistance(chunk.embedding, input.queryEmbedding)})`
  return db
    .select({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      embedding: chunk.embedding,
      page: chunk.page,
      charOffset: chunk.charOffset,
      chunkIndex: chunk.chunkIndex,
      createdAt: chunk.createdAt,
      similarity,
    })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(
      and(
        eq(document.userId, input.userId),
        eq(document.status, "indexed"),
        inArray(chunk.documentId, input.documentIds),
        gt(similarity, 0),
      ),
    )
    .orderBy(desc(similarity))
    .limit(input.k ?? 8)
}
