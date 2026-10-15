import { zValidator } from "@hono/zod-validator"
import { streamText, type LanguageModel } from "ai"
import { eq } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { createMiddleware } from "hono/factory"
import { streamSSE } from "hono/streaming"
import { z } from "zod"

import {
  appMeta,
  countDocumentsByProject,
  createAssistantMessage,
  createDocument,
  createProject,
  createSession,
  createUserMessage,
  deleteDocument,
  getDocument,
  getMessage,
  getProject,
  getSession,
  listDocuments,
  listMessages,
  listProjects,
  listSessions,
  markProcessing,
  retrieveCandidates,
  touchSession,
  type ChatSession,
  type Database,
  type Document,
  type MessageWithCitations,
  type Project,
} from "@alex/db"

import type { Auth } from "./auth.ts"
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts"
import {
  ANSWER_MODELS,
  buildPrompt,
  CONDENSE_HISTORY_TURNS,
  DEFAULT_ANSWER_MODEL,
  isAllowedModel,
  OVER_FETCH,
  rankCandidates,
  SYSTEM_PROMPT,
  validateCitations,
  type Condenser,
  type CondenseTurn,
} from "./chat/index.ts"
import {
  MAX_PAGES,
  MAX_UPLOAD_BYTES,
  pdfPageCount,
  resolveFileType,
  type Embedder,
  type FileType,
  type ObjectStore,
} from "./ingest/index.ts"

/** The authenticated principal exposed to protected routes. */
export type SessionUser = {
  id: string
  email: string
  name: string
  image?: string | null
}

type Variables = {
  userId: string
  user: SessionUser
}

export type ApiDeps = {
  db: Database
  auth: Auth
  /** Where original uploads are stored (ADR-0007) — injected so tests fake it. */
  store: ObjectStore
  /** Enqueue an ingestion job for a document (ADR-0006). */
  enqueueIngest: (documentId: string) => Promise<void>
  /** Embeds the query for retrieval (CONTEXT §4.4) — faked in tests (ADR-0012). */
  embedder: Embedder
  /**
   * Resolves a validated answer-model id to a `LanguageModel` (ADR-0010). The id
   * is checked against the server allowlist before this is called; tests inject a
   * factory returning a mock model so no real generation runs in CI.
   */
  answerModel: (modelId: string) => LanguageModel
  /**
   * Rewrites a follow-up into a standalone retrieval query (CONTEXT §4.3). Pinned
   * to `gpt-4o-mini`, never user-selectable; the route only calls it on follow-ups
   * and falls back to the raw question. Faked deterministically in tests.
   */
  condense: Condenser
  /**
   * Per-user chat limiter (ADR-0011): chat turns, incl. regenerates. Defaults to
   * 30 per 10 minutes; injectable so tests can exhaust it.
   */
  chatLimiter?: RateLimiter
}

/** Node has a global `File` (undici); narrow a parsed field to it. */
function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File
}

/** The S3 content-type stored for an original, by resolved file type. */
const CONTENT_TYPE: Record<FileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

/** Request body for creating a project (ADR-0009: zod at the boundary). */
const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional(),
})

/**
 * The client-facing shape of a project. DB row dates become ISO strings, and the
 * `docCount`/`chatCount` the dashboard renders are attached here — derived, not
 * stored (0 until the document and chat_session tables land in later slices).
 * Keeping this mapping in the API means DB row types never leak to the web app
 * (ADR-0009).
 */
export type ProjectDto = {
  id: string
  name: string
  description: string
  docCount: number
  chatCount: number
  createdAt: string
  updatedAt: string
}

// `docCount` is derived from the document table (CONTEXT §3), passed in by the
// caller so it can't drift; `chatCount` stays 0 until the chat slice (#5).
function toProjectDto(row: Project, docCount = 0): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    docCount,
    chatCount: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * The client-facing shape of a document: the ingestion `status` and, on failure,
 * the surfaced `errorMessage` the documents route renders. Storage keys and the
 * owning `userId` never leave the API (ADR-0009).
 */
export type DocumentDto = {
  id: string
  filename: string
  fileType: string
  sizeBytes: number
  pageCount: number
  status: "processing" | "indexed" | "failed"
  errorMessage: string | null
  createdAt: string
}

function toDocumentDto(row: Document): DocumentDto {
  return {
    id: row.id,
    filename: row.filename,
    fileType: row.fileType,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The client-facing shape of a chat session — the history sidebar entry. */
export type ChatSessionDto = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

function toSessionDto(row: ChatSession): ChatSessionDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * The client-facing shape of a citation — the numbered passage the sources panel
 * renders (ADR-0005). Snapshotted at answer time; the soft `chunkId` reference
 * never leaves the API.
 */
export type CitationDto = {
  n: number
  documentId: string
  documentName: string
  page: number
  chunkIndex: number
  snippet: string
}

/**
 * The client-facing shape of a message. User turns carry their per-turn
 * `selectedDocumentIds`; assistant turns carry the `modelId` that produced them,
 * their terminal `status`, and their validated `citations`.
 */
export type MessageDto = {
  id: string
  role: "user" | "assistant"
  content: string
  status: "complete" | "stopped" | "failed"
  selectedDocumentIds: string[]
  modelId: string | null
  /** Set when this answer supersedes an earlier one (CONTEXT §4.6); else null. */
  regeneratedFrom: string | null
  citations: CitationDto[]
  createdAt: string
}

function toMessageDto(row: MessageWithCitations): MessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    selectedDocumentIds: row.selectedDocumentIds,
    modelId: row.modelId,
    regeneratedFrom: row.regeneratedFrom,
    citations: row.citations
      .map((c) => ({
        n: c.n,
        documentId: c.documentId,
        documentName: c.documentName,
        page: c.page,
        chunkIndex: c.chunkIndex,
        snippet: c.snippet,
      }))
      .sort((a, b) => a.n - b.n),
    createdAt: row.createdAt.toISOString(),
  }
}

/** Session title seeded from the first user message (CONTEXT §4). */
function deriveTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ")
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed || "New chat"
}

/**
 * The last ~N turns as condense context (CONTEXT §4.3), oldest-first. Only the
 * role and text matter to the rewrite; citations and provenance are dropped.
 */
function toCondenseHistory(
  messages: MessageWithCitations[],
): CondenseTurn[] {
  return messages
    .slice(-CONDENSE_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }))
}

/** Request body for the grounded-chat turn (ADR-0003 selection, ADR-0010 model). */
const chatTurnSchema = z.object({
  // Omitted on the first turn of a new session; the server creates one.
  sessionId: z.string().optional(),
  content: z.string().trim().min(1, "Message is required").max(4000),
  // Send is blocked with 0 selected documents (ADR-0003) — enforced here too.
  selectedDocumentIds: z.array(z.string()).min(1, "Select at least one document"),
  // Validated against the server allowlist (ADR-0010); rejects anything else.
  model: z.string().refine(isAllowedModel, "Unknown model"),
})

/**
 * Request body for regenerating an answer (CONTEXT §4.6). The user turn and its
 * document scope are reused from the message being regenerated; only the answer
 * model is chosen afresh — so a re-answer can switch models, still allowlisted.
 */
const regenerateSchema = z.object({
  model: z.string().refine(isAllowedModel, "Unknown model"),
})

/**
 * Guard for user-scoped routes (ADR-0001/ADR-0002): resolves the httpOnly-cookie
 * session and puts the authenticated `userId` on the context. Every domain query
 * downstream filters by `c.get("userId")` — this is where that pattern starts.
 * Unauthenticated requests get a 401 (the web guard turns that into a redirect).
 */
function requireAuth(auth: Auth) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ error: "unauthorized" as const }, 401)
    }
    c.set("userId", session.user.id)
    c.set("user", session.user as SessionUser)
    await next()
  })
}

/**
 * Per-user chat rate limit (ADR-0011), keyed by the authenticated user. Counts
 * at request time, so a burst of parallel turns can't slip past before any of
 * them is persisted. Mounted after validation so malformed requests are free.
 */
function chatRateLimit(limiter: RateLimiter) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const hit = limiter.take(c.get("userId"))
    if (!hit.ok) {
      c.header("Retry-After", String(hit.retryAfterSec))
      return c.json(
        { error: "rate_limited" as const, retryAfterSec: hit.retryAfterSec },
        429,
      )
    }
    await next()
  })
}

/**
 * Build the Hono API. Routes are mounted at the root here and served under
 * `/api` by the server (and the web client's `hc` base), so `AppType` stays
 * prefix-free. `db` and `auth` are injected so tests can supply fakes without a
 * real Postgres or a live better-auth instance.
 */
export function createApi(deps: ApiDeps) {
  const { db, auth, store, enqueueIngest, embedder, answerModel, condense } =
    deps
  const chatLimiter =
    deps.chatLimiter ??
    createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 })

  const app = new Hono<{ Variables: Variables }>()

  // better-auth owns everything under /auth (sign-in/up/out, session). It reads
  // and writes the httpOnly cookie itself; we just hand it the raw request.
  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw))

  /**
   * The grounded-answer engine shared by the initial turn and regenerate
   * (CONTEXT §4.3–4.6). Given a resolved session, the question to answer, its
   * owned document scope, and the prior turns, it: condenses the query on a
   * follow-up, retrieves + ranks over the selected+indexed chunks, streams the
   * answer as SSE, then validates the `[n]` markers and persists the finalized
   * assistant message — before writing `done`, so the client never races a
   * refetch. A cancelled stream is kept as `stopped`; `regeneratedFrom` links a
   * re-answer to the one it supersedes without touching the original.
   */
  function streamAnswer(
    c: Context<{ Variables: Variables }>,
    params: {
      session: ChatSession
      userId: string
      question: string
      selected: string[]
      history: CondenseTurn[]
      model: string
      regeneratedFrom?: string | null
      startData?: Record<string, unknown>
    },
  ) {
    const { session, userId, question, selected, history, model } = params
    return streamSSE(c, async (stream) => {
      // Let the client route to the (possibly new) session immediately.
      await stream.writeSSE({
        event: "start",
        data: JSON.stringify({ sessionId: session.id, ...params.startData }),
      })

      // Condense a follow-up into a standalone query before retrieval; the first
      // turn (empty history) is already standalone and skips the round-trip.
      const query =
        history.length > 0
          ? await condense.condense({ question, history })
          : question

      // Retrieve: embed the (condensed) query, cosine search selected+indexed
      // chunks, then apply the per-doc cap / floor / top-k ranking (ADR-0004).
      const [queryEmbedding] = await embedder.embed([query])
      const candidates = await retrieveCandidates(db, {
        userId,
        documentIds: selected,
        queryEmbedding: queryEmbedding ?? [],
        limit: OVER_FETCH,
      })
      const chunks = rankCandidates(candidates)

      // Answer the user's actual question; grounding comes from the chunks the
      // condensed query retrieved.
      const result = streamText({
        model: answerModel(model),
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(question, chunks),
        abortSignal: c.req.raw.signal,
      })

      let text = ""
      let stopped = false
      try {
        for await (const delta of result.textStream) {
          text += delta
          await stream.writeSSE({
            event: "delta",
            data: JSON.stringify({ text: delta }),
          })
        }
      } catch {
        // Client aborted (or the model stream broke) — keep the partial answer.
        stopped = true
      }

      // Validate the [n] markers and snapshot the cited chunks (ADR-0005).
      const citations = validateCitations(text, chunks)
      // Usage is only meaningful on a clean finish; on a stopped/broken stream it
      // may never settle, so don't await it (it would hang the finalize).
      const usage = stopped
        ? undefined
        : await result.usage.catch(() => undefined)

      const assistant = await createAssistantMessage(db, {
        sessionId: session.id,
        userId,
        content: text,
        status: stopped ? "stopped" : "complete",
        modelId: model,
        tokenUsage: {
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
        },
        citations,
        regeneratedFrom: params.regeneratedFrom ?? null,
      })

      // Finalized and persisted — hand the client the message + sources so it can
      // render without a refetch race.
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          messageId: assistant.id,
          status: assistant.status,
          regeneratedFrom: assistant.regeneratedFrom,
          citations: citations.map((c2) => ({
            n: c2.n,
            documentId: c2.documentId,
            documentName: c2.documentName,
            page: c2.page,
            chunkIndex: c2.chunkIndex,
            snippet: c2.snippet,
          })),
        }),
      })
    })
  }

  return app
    .get("/health", async (c) => {
      const startedAt = Date.now()
      try {
        const [row] = await db
          .select()
          .from(appMeta)
          .where(eq(appMeta.key, "schema_version"))
        return c.json({
          status: "ok" as const,
          db: "up" as const,
          schemaVersion: row?.value ?? "unknown",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
        })
      } catch (err) {
        c.status(503)
        return c.json({
          status: "degraded" as const,
          db: "down" as const,
          error: err instanceof Error ? err.message : "unknown error",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
        })
      }
    })
    // First user-scoped endpoint: the signed-in principal behind the dashboard.
    .get("/me", requireAuth(auth), (c) => c.json({ user: c.get("user") }))
    // Projects — the user's owned workspaces (ADR-0001). Every handler reads
    // `c.get("userId")` from the guard and scopes its query to it, so a user
    // only ever sees or mutates their own rows.
    .get("/projects", requireAuth(auth), async (c) => {
      const userId = c.get("userId")
      const [rows, docCounts] = await Promise.all([
        listProjects(db, userId),
        countDocumentsByProject(db, userId),
      ])
      return c.json({
        projects: rows.map((r) => toProjectDto(r, docCounts[r.id] ?? 0)),
      })
    })
    .post(
      "/projects",
      requireAuth(auth),
      zValidator("json", createProjectSchema),
      async (c) => {
        const { name, description } = c.req.valid("json")
        const row = await createProject(db, {
          userId: c.get("userId"),
          name,
          description,
        })
        return c.json({ project: toProjectDto(row) }, 201)
      },
    )
    .get("/projects/:id", requireAuth(auth), async (c) => {
      const userId = c.get("userId")
      const row = await getProject(db, userId, c.req.param("id"))
      // A missing id and another user's id are indistinguishable by design.
      if (!row) return c.json({ error: "not_found" as const }, 404)
      const docCounts = await countDocumentsByProject(db, userId)
      return c.json({ project: toProjectDto(row, docCounts[row.id] ?? 0) })
    })
    // Documents — files uploaded into a project, with an ingestion lifecycle
    // (CONTEXT §5). Every route re-verifies project ownership before touching a
    // document, so tenancy holds across the project→document boundary.
    .get("/projects/:projectId/documents", requireAuth(auth), async (c) => {
      const userId = c.get("userId")
      const projectId = c.req.param("projectId")
      if (!(await getProject(db, userId, projectId))) {
        return c.json({ error: "not_found" as const }, 404)
      }
      const rows = await listDocuments(db, userId, projectId)
      return c.json({ documents: rows.map(toDocumentDto) })
    })
    // Upload: enforce the ADR-0011 caps at the edge, store the original in R2,
    // create a `processing` row, and enqueue ingestion — in that order, so bad
    // input never reaches storage or burns a retry.
    .post("/projects/:projectId/documents", requireAuth(auth), async (c) => {
      const userId = c.get("userId")
      const projectId = c.req.param("projectId")
      if (!(await getProject(db, userId, projectId))) {
        return c.json({ error: "not_found" as const }, 404)
      }

      const body = await c.req.parseBody()
      const file = body.file
      if (!isFile(file)) {
        return c.json({ error: "file_required" as const }, 400)
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json({ error: "too_large" as const, maxBytes: MAX_UPLOAD_BYTES }, 413)
      }
      const fileType = resolveFileType(file.name, file.type)
      if (!fileType) {
        return c.json({ error: "unsupported_type" as const }, 415)
      }

      const bytes = new Uint8Array(await file.arrayBuffer())

      // Page cap is meaningful only for PDFs; DOCX has no reliable page count.
      let pageCount = 1
      if (fileType === "pdf") {
        try {
          pageCount = await pdfPageCount(bytes)
        } catch {
          return c.json({ error: "unreadable_pdf" as const }, 422)
        }
        if (pageCount > MAX_PAGES) {
          return c.json({ error: "too_many_pages" as const, maxPages: MAX_PAGES }, 413)
        }
      }

      const safeName = file.name.replace(/[^\w.\-]+/g, "_")
      const storageKey = `documents/${userId}/${crypto.randomUUID()}-${safeName}`
      await store.put(storageKey, bytes, CONTENT_TYPE[fileType])

      const doc = await createDocument(db, {
        projectId,
        userId,
        filename: file.name,
        fileType,
        sizeBytes: file.size,
        pageCount,
        storageKey,
      })
      await enqueueIngest(doc.id)

      return c.json({ document: toDocumentDto(doc) }, 201)
    })
    // Re-ingest: reset to `processing` and re-enqueue. Safe to repeat — the job
    // is idempotent (delete-then-insert), so this recovers a `failed` doc or
    // re-indexes after a chunking change without duplicating chunks (ADR-0006).
    .post(
      "/projects/:projectId/documents/:id/reingest",
      requireAuth(auth),
      async (c) => {
        const userId = c.get("userId")
        const id = c.req.param("id")
        if (!(await getDocument(db, userId, id))) {
          return c.json({ error: "not_found" as const }, 404)
        }
        await markProcessing(db, id)
        await enqueueIngest(id)
        const updated = await getDocument(db, userId, id)
        if (!updated) return c.json({ error: "not_found" as const }, 404)
        return c.json({ document: toDocumentDto(updated) })
      },
    )
    // Delete: remove the original from R2 (best-effort) then the row (chunks
    // cascade). A missing object doesn't block the DB delete.
    .delete("/projects/:projectId/documents/:id", requireAuth(auth), async (c) => {
      const userId = c.get("userId")
      const id = c.req.param("id")
      const doc = await getDocument(db, userId, id)
      if (!doc) return c.json({ error: "not_found" as const }, 404)
      try {
        await store.delete(doc.storageKey)
      } catch {
        // The row is the source of truth; an orphaned object is harmless.
      }
      await deleteDocument(db, userId, id)
      return c.body(null, 204)
    })
    // The answer-model allowlist the picker offers (ADR-0010). The UI can only
    // show what the server allows; the chat route re-validates on every request.
    .get("/chat/models", requireAuth(auth), (c) =>
      c.json({ models: ANSWER_MODELS, default: DEFAULT_ANSWER_MODEL }),
    )
    // A project's chat sessions — the history sidebar (CONTEXT §3).
    .get(
      "/projects/:projectId/chat/sessions",
      requireAuth(auth),
      async (c) => {
        const userId = c.get("userId")
        const projectId = c.req.param("projectId")
        if (!(await getProject(db, userId, projectId))) {
          return c.json({ error: "not_found" as const }, 404)
        }
        const rows = await listSessions(db, userId, projectId)
        return c.json({ sessions: rows.map(toSessionDto) })
      },
    )
    // A session's messages with their citations, in order (CONTEXT §4.7).
    .get(
      "/projects/:projectId/chat/sessions/:sessionId/messages",
      requireAuth(auth),
      async (c) => {
        const userId = c.get("userId")
        const sessionId = c.req.param("sessionId")
        if (!(await getSession(db, userId, sessionId))) {
          return c.json({ error: "not_found" as const }, 404)
        }
        const rows = await listMessages(db, userId, sessionId)
        return c.json({ messages: rows.map(toMessageDto) })
      },
    )
    // The core product moment (CONTEXT §4): persist the user turn, retrieve over
    // the selected+indexed chunks, stream a grounded answer, and finalize with
    // validated citations. Streams SSE (the client reads it with raw `fetch`, not
    // `hc`); zod rejects a 0-doc turn or an off-allowlist model before any DB work.
    .post(
      "/projects/:projectId/chat",
      requireAuth(auth),
      zValidator("json", chatTurnSchema),
      chatRateLimit(chatLimiter),
      async (c) => {
        const userId = c.get("userId")
        const projectId = c.req.param("projectId")
        if (!(await getProject(db, userId, projectId))) {
          return c.json({ error: "not_found" as const }, 404)
        }
        const { sessionId, content, selectedDocumentIds, model } =
          c.req.valid("json")

        // Keep only selected docs the user actually owns in this project (tenancy).
        const owned = new Set(
          (await listDocuments(db, userId, projectId)).map((d) => d.id),
        )
        const selected = selectedDocumentIds.filter((id) => owned.has(id))
        if (selected.length === 0) {
          return c.json({ error: "invalid_documents" as const }, 400)
        }

        // Resolve the session (must be the user's), or open a new one for turn 1.
        let session = sessionId
          ? await getSession(db, userId, sessionId)
          : undefined
        if (sessionId && !session) {
          return c.json({ error: "not_found" as const }, 404)
        }
        // Prior turns (before this one) become the condense context on a
        // follow-up; a brand-new session has none, so its first turn skips
        // condensing (CONTEXT §4.3). Read before persisting the new user turn.
        const history = session
          ? toCondenseHistory(await listMessages(db, userId, session.id))
          : []
        if (!session) {
          session = await createSession(db, {
            projectId,
            userId,
            title: deriveTitle(content),
          })
        }

        // Persist the user turn BEFORE retrieval so it survives a failed
        // generation and can be retried without re-retrieving (CONTEXT §4.2).
        const userMessage = await createUserMessage(db, {
          sessionId: session.id,
          userId,
          content,
          selectedDocumentIds: selected,
        })
        await touchSession(db, session.id)

        return streamAnswer(c, {
          session,
          userId,
          question: content,
          selected,
          history,
          model,
          startData: { userMessageId: userMessage.id },
        })
      },
    )
    // Regenerate an answer (CONTEXT §4.6): re-run the user turn a given assistant
    // message answered, producing a *new* assistant message linked via
    // `regeneratedFrom` — the original is never destroyed. The model can change
    // (still allowlisted); the question and its document scope are reused.
    .post(
      "/projects/:projectId/chat/messages/:messageId/regenerate",
      requireAuth(auth),
      zValidator("json", regenerateSchema),
      chatRateLimit(chatLimiter),
      async (c) => {
        const userId = c.get("userId")
        const projectId = c.req.param("projectId")
        const messageId = c.req.param("messageId")
        const { model } = c.req.valid("json")

        // The message must be the user's, an assistant turn, in this project.
        const target = await getMessage(db, userId, messageId)
        if (!target || target.role !== "assistant") {
          return c.json({ error: "not_found" as const }, 404)
        }
        const session = await getSession(db, userId, target.sessionId)
        if (!session || session.projectId !== projectId) {
          return c.json({ error: "not_found" as const }, 404)
        }

        // Find the user turn this answer responded to — the nearest user message
        // before it — and reuse its question and document scope.
        const all = await listMessages(db, userId, session.id)
        const targetIndex = all.findIndex((m) => m.id === messageId)
        let userTurnIndex = -1
        for (let i = targetIndex - 1; i >= 0; i--) {
          if (all[i]!.role === "user") {
            userTurnIndex = i
            break
          }
        }
        if (userTurnIndex === -1) {
          return c.json({ error: "not_found" as const }, 404)
        }
        const userTurn = all[userTurnIndex]!

        // Re-scope to documents the user still owns in this project (tenancy) —
        // a doc selected then deleted must drop out.
        const owned = new Set(
          (await listDocuments(db, userId, projectId)).map((d) => d.id),
        )
        const selected = userTurn.selectedDocumentIds.filter((id) =>
          owned.has(id),
        )
        if (selected.length === 0) {
          return c.json({ error: "invalid_documents" as const }, 400)
        }

        // Condense context is the turns before the user turn being re-answered.
        const history = toCondenseHistory(all.slice(0, userTurnIndex))
        await touchSession(db, session.id)

        return streamAnswer(c, {
          session,
          userId,
          question: userTurn.content,
          selected,
          history,
          model,
          regeneratedFrom: messageId,
          startData: { regeneratedFrom: messageId },
        })
      },
    )
}

/** The typed shape the web client consumes via `hc<AppType>`. */
export type AppType = ReturnType<typeof createApi>
