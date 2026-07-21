import {
  getDocumentById,
  markIndexed,
  replaceDocumentChunks,
  type ChunkInput,
  type Database,
} from "@alex/db"

import { chunkPages } from "./chunker.ts"
import type { Embedder } from "./embeddings.ts"
import { extractPages, type FileType } from "./extract.ts"
import type { ObjectStore } from "./storage.ts"

/**
 * The worker's unit of work (CONTEXT §5, ADR-0006): turn one uploaded document
 * into indexed chunks. Deliberately a plain async function, not bound to the
 * queue, so the integration test can drive the whole extract → chunk → embed →
 * store pipeline directly with fake deps.
 *
 * Errors propagate to the caller (the pg-boss handler), which decides retry vs.
 * terminal `failed`. Chunks are written delete-then-insert in a transaction and
 * `status` flips to `indexed` only *after* that commit, so retrieval never sees
 * a half-indexed document.
 */
export type IngestDeps = {
  db: Database
  store: ObjectStore
  embedder: Embedder
}

export async function ingestDocument(
  deps: IngestDeps,
  documentId: string,
): Promise<void> {
  const { db, store, embedder } = deps

  const doc = await getDocumentById(db, documentId)
  if (!doc) throw new Error(`ingest: document ${documentId} not found`)

  const bytes = await store.get(doc.storageKey)
  const { pages } = await extractPages(bytes, doc.fileType as FileType)
  const chunks = chunkPages(pages)

  if (chunks.length === 0) {
    throw new Error("No text could be extracted from the document")
  }

  const embeddings = await embedder.embed(chunks.map((c) => c.content))
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `ingest: embedder returned ${embeddings.length} vectors for ${chunks.length} chunks`,
    )
  }

  const rows: ChunkInput[] = chunks.map((c, i) => ({
    content: c.content,
    embedding: embeddings[i] as number[],
    page: c.page,
    charOffset: c.charOffset,
    chunkIndex: c.chunkIndex,
  }))

  // Delete-then-insert in a tx, then flip to indexed after it commits.
  await replaceDocumentChunks(db, documentId, rows)
  await markIndexed(db, documentId)
}
