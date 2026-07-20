import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"

import { appMeta, type Database } from "@alex/db"

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
}

/** The typed shape the web client consumes via `hc<AppType>`. */
export type AppType = ReturnType<typeof createApi>
