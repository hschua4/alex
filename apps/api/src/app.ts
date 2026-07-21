import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import {
  appMeta,
  countDocumentsByProject,
  createDocument,
  createProject,
  deleteDocument,
  getDocument,
  getProject,
  listDocuments,
  listProjects,
  markProcessing,
  type Database,
  type Document,
  type Project,
} from "@alex/db"

import type { Auth } from "./auth.ts"
import {
  MAX_PAGES,
  MAX_UPLOAD_BYTES,
  pdfPageCount,
  resolveFileType,
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
 * Build the Hono API. Routes are mounted at the root here and served under
 * `/api` by the server (and the web client's `hc` base), so `AppType` stays
 * prefix-free. `db` and `auth` are injected so tests can supply fakes without a
 * real Postgres or a live better-auth instance.
 */
export function createApi(deps: ApiDeps) {
  const { db, auth, store, enqueueIngest } = deps

  const app = new Hono<{ Variables: Variables }>()

  // better-auth owns everything under /auth (sign-in/up/out, session). It reads
  // and writes the httpOnly cookie itself; we just hand it the raw request.
  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw))

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
}

/** The typed shape the web client consumes via `hc<AppType>`. */
export type AppType = ReturnType<typeof createApi>
