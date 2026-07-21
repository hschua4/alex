import { describe, expect, it } from "vitest"

import type { Database } from "@alex/db"

import { createApi, type SessionUser } from "../src/app.ts"
import type { Auth } from "../src/auth.ts"

/**
 * Route-boundary behavior for /projects that doesn't need a database: the auth
 * guard and zod validation both short-circuit before any query runs. The tenancy
 * *filtering* is proven separately against real Postgres in `project.test.ts`.
 */
function fakeAuth(session: { user: SessionUser } | null): Auth {
  return {
    handler: async () => new Response("{}"),
    api: { getSession: async () => session },
  } as unknown as Auth
}

const noDb = {} as Database
const user: SessionUser = {
  id: "user_1",
  email: "member@example.com",
  name: "Member",
  image: null,
}

describe("projects routes — guard", () => {
  it("401s every project route when unauthenticated", async () => {
    const api = createApi({ db: noDb, auth: fakeAuth(null) })

    const list = await api.request("/projects")
    expect(list.status).toBe(401)

    const create = await api.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    })
    expect(create.status).toBe(401)

    const get = await api.request("/projects/anything")
    expect(get.status).toBe(401)
  })
})

describe("projects routes — create validation", () => {
  it("400s a create with a blank name (before touching the db)", async () => {
    const api = createApi({ db: noDb, auth: fakeAuth({ user }) })
    const res = await api.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    })
    expect(res.status).toBe(400)
  })

  it("400s a create with a missing name", async () => {
    const api = createApi({ db: noDb, auth: fakeAuth({ user }) })
    const res = await api.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "orphan" }),
    })
    expect(res.status).toBe(400)
  })
})
