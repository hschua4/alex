import { eq } from "drizzle-orm"
import { Hono } from "hono"

import { appMeta, type Database } from "@alex/db"

export type ApiDeps = {
  db: Database
}

/**
 * Build the Hono API. Routes are mounted at the root here and served under
 * `/api` by the server (and the web client's `hc` base), so `AppType` stays
 * prefix-free. `db` is injected so tests can supply a fake without a real
 * Postgres.
 */
export function createApi(deps: ApiDeps) {
  const { db } = deps

  return new Hono().get("/health", async (c) => {
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
}

/** The typed shape the web client consumes via `hc<AppType>`. */
export type AppType = ReturnType<typeof createApi>
