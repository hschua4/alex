import { randomUUID } from "node:crypto"

import { and, asc, cosineDistance, desc, eq, gt, inArray, sql } from "drizzle-orm"

import type { Database } from "./client.ts"
import {
  chatSession,
  chunk,
  document,
  message,
  messageCitation,
  type ChatSession,
  type Message,
  type MessageCitation,
  type TokenUsage,
} from "./schema.ts"

/**
 * Chat session / message / citation queries (ADR-0001 tenancy, ADR-0005
 * citations). Like the other domain helpers these live in the db package so the
 * query builders and tables come from one drizzle-orm instance. Every read and
 * mutation is scoped by `userId`: a session or message id alone never authorizes
 * access.
 */

// ── sessions ─────────────────────────────────────────────────────────────────

/** Create a chat session in a project, owned by `userId`. Returns the row. */
export async function createSession(
  db: Database,
  input: { projectId: string; userId: string; title: string },
): Promise<ChatSession> {
  const [row] = await db
    .insert(chatSession)
    .values({ id: randomUUID(), ...input })
    .returning()
  if (!row) throw new Error("createSession: insert returned no row")
  return row
}

/** A project's chat sessions for `userId`, most-recently-updated first. */
export async function listSessions(
  db: Database,
  userId: string,
  projectId: string,
): Promise<ChatSession[]> {
  return db
    .select()
    .from(chatSession)
    .where(
      and(eq(chatSession.userId, userId), eq(chatSession.projectId, projectId)),
    )
    .orderBy(desc(chatSession.updatedAt))
}

/** A single session, but only if it belongs to `userId`. */
export async function getSession(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<ChatSession | undefined> {
  const [row] = await db
    .select()
    .from(chatSession)
    .where(and(eq(chatSession.id, sessionId), eq(chatSession.userId, userId)))
    .limit(1)
  return row
}

/** Bump a session's `updatedAt` so it sorts to the top of the history sidebar. */
export async function touchSession(
  db: Database,
  sessionId: string,
): Promise<void> {
  await db
    .update(chatSession)
    .set({ updatedAt: new Date() })
    .where(eq(chatSession.id, sessionId))
}

// ── messages ─────────────────────────────────────────────────────────────────

/**
 * Persist a user turn (CONTEXT §4.2) — written *before* retrieval so the turn and
 * its `selectedDocumentIds` survive a failed generation. Always `complete`.
 */
export async function createUserMessage(
  db: Database,
  input: {
    sessionId: string
    userId: string
    content: string
    selectedDocumentIds: string[]
  },
): Promise<Message> {
  const [row] = await db
    .insert(message)
    .values({
      id: randomUUID(),
      sessionId: input.sessionId,
      userId: input.userId,
      role: "user",
      content: input.content,
      selectedDocumentIds: input.selectedDocumentIds,
    })
    .returning()
  if (!row) throw new Error("createUserMessage: insert returned no row")
  return row
}

/** A validated citation ready to persist against an assistant message. */
export type CitationInput = {
  n: number
  chunkId: string | null
  documentId: string
  documentName: string
  page: number
  chunkIndex: number
  snippet: string
}

/**
 * Finalize an assistant turn (CONTEXT §4.6): insert the message with its text,
 * `modelId`, and `tokenUsage`, then its validated citations — atomically, so a
 * message never lands without the citations the sources panel reads. `status` is
 * `stopped` for a cancelled stream, `complete` otherwise. `regeneratedFrom`, when
 * set, links this answer to the one it supersedes — regenerate is additive, so the
 * original is never touched (CONTEXT §4.6).
 */
export async function createAssistantMessage(
  db: Database,
  input: {
    sessionId: string
    userId: string
    content: string
    status: "complete" | "stopped"
    modelId: string
    tokenUsage: TokenUsage
    citations: CitationInput[]
    regeneratedFrom?: string | null
  },
): Promise<Message> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(message)
      .values({
        id: randomUUID(),
        sessionId: input.sessionId,
        userId: input.userId,
        role: "assistant",
        content: input.content,
        status: input.status,
        modelId: input.modelId,
        tokenUsage: input.tokenUsage,
        regeneratedFrom: input.regeneratedFrom ?? null,
      })
      .returning()
    if (!row) throw new Error("createAssistantMessage: insert returned no row")
    if (input.citations.length > 0) {
      await tx.insert(messageCitation).values(
        input.citations.map((c) => ({
          id: randomUUID(),
          messageId: row.id,
          n: c.n,
          chunkId: c.chunkId,
          documentId: c.documentId,
          documentName: c.documentName,
          page: c.page,
          chunkIndex: c.chunkIndex,
          snippet: c.snippet,
        })),
      )
    }
    return row
  })
}

/** A message with its citations attached (empty for user turns). */
export type MessageWithCitations = Message & { citations: MessageCitation[] }

/**
 * All messages in a session, in creation order, each with its citations. Scoped
 * by `userId` on the session — a session id alone never authorizes access.
 */
export async function listMessages(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<MessageWithCitations[]> {
  const messages = await db
    .select()
    .from(message)
    .where(and(eq(message.sessionId, sessionId), eq(message.userId, userId)))
    .orderBy(asc(message.createdAt))
  if (messages.length === 0) return []

  const citations = await db
    .select()
    .from(messageCitation)
    .where(
      inArray(
        messageCitation.messageId,
        messages.map((m) => m.id),
      ),
    )
    .orderBy(asc(messageCitation.n))

  const byMessage = new Map<string, MessageCitation[]>()
  for (const c of citations) {
    const list = byMessage.get(c.messageId) ?? []
    list.push(c)
    byMessage.set(c.messageId, list)
  }
  return messages.map((m) => ({ ...m, citations: byMessage.get(m.id) ?? [] }))
}

/**
 * A single message, but only if it belongs to `userId` — the scoping guard for
 * regenerate, which resolves the assistant answer to re-run from its id alone.
 */
export async function getMessage(
  db: Database,
  userId: string,
  messageId: string,
): Promise<Message | undefined> {
  const [row] = await db
    .select()
    .from(message)
    .where(and(eq(message.id, messageId), eq(message.userId, userId)))
    .limit(1)
  return row
}

// ── retrieval ────────────────────────────────────────────────────────────────

/** A retrieval candidate: a chunk, its cosine similarity, and its document name. */
export type Candidate = {
  chunkId: string
  documentId: string
  documentName: string
  content: string
  page: number
  chunkIndex: number
  similarity: number
}

/**
 * Over-fetch retrieval candidates (ADR-0004): cosine top-`limit` over the HNSW
 * index, filtered to the owner's `indexed` documents within the selected set,
 * joined to the document name for the citation snapshot. The per-doc cap,
 * similarity floor, and final top-k are applied *in the app* over these rows
 * (pure, unit-tested); this query just supplies enough ranked candidates.
 */
export async function retrieveCandidates(
  db: Database,
  input: {
    userId: string
    documentIds: string[]
    queryEmbedding: number[]
    limit: number
  },
): Promise<Candidate[]> {
  if (input.documentIds.length === 0) return []
  const similarity = sql<number>`1 - (${cosineDistance(chunk.embedding, input.queryEmbedding)})`
  return db
    .select({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: document.filename,
      content: chunk.content,
      page: chunk.page,
      chunkIndex: chunk.chunkIndex,
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
    .limit(input.limit)
}
