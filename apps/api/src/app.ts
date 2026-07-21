import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import {
  appMeta,
  createProject,
  getProject,
  listProjects,
  type Database,
  type Project,
} from "@alex/db"

import type { Auth } from "./auth.ts"

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

function toProjectDto(row: Project): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    docCount: 0,
    chatCount: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
  const { db, auth } = deps

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
      const rows = await listProjects(db, c.get("userId"))
      return c.json({ projects: rows.map(toProjectDto) })
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
      const row = await getProject(db, c.get("userId"), c.req.param("id"))
      // A missing id and another user's id are indistinguishable by design.
      if (!row) return c.json({ error: "not_found" as const }, 404)
      return c.json({ project: toProjectDto(row) })
    })
}

/** The typed shape the web client consumes via `hc<AppType>`. */
export type AppType = ReturnType<typeof createApi>
