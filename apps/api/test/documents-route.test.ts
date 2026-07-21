import { describe, expect, it } from "vitest"

import type { Database } from "@alex/db"

import { createApi, type SessionUser } from "../src/app.ts"
import type { Auth } from "../src/auth.ts"
import { createMemoryStore } from "../src/ingest/index.ts"

/**
 * Guard behavior for the document routes that needs no database: the auth guard
 * short-circuits every route before any query runs. Caps, storage, and the
 * ingestion pipeline are proven against real Postgres in
 * `ingest.integration.test.ts`.
 */
function fakeAuth(session: { user: SessionUser } | null): Auth {
  return {
    handler: async () => new Response("{}"),
    api: { getSession: async () => session },
  } as unknown as Auth
}

const noDb = {} as Database
const deps = {
  db: noDb,
  auth: fakeAuth(null),
  store: createMemoryStore(),
  enqueueIngest: async () => {},
}

describe("documents routes — guard", () => {
  it("401s every document route when unauthenticated", async () => {
    const api = createApi(deps)

    const list = await api.request("/projects/p1/documents")
    expect(list.status).toBe(401)

    const upload = await api.request("/projects/p1/documents", {
      method: "POST",
    })
    expect(upload.status).toBe(401)

    const reingest = await api.request("/projects/p1/documents/d1/reingest", {
      method: "POST",
    })
    expect(reingest.status).toBe(401)

    const del = await api.request("/projects/p1/documents/d1", {
      method: "DELETE",
    })
    expect(del.status).toBe(401)
  })
})
