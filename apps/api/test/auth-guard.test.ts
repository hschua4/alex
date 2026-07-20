import { describe, expect, it } from "vitest"

import type { Database } from "@alex/db"

import { createApi, type SessionUser } from "../src/app.ts"
import type { Auth } from "../src/auth.ts"

/**
 * A minimal fake better-auth: only the `handler` + `api.getSession` surface the
 * Hono app touches. `getSession` decides whether a request is authenticated, so
 * we can drive the guard without a real session cookie or Postgres.
 */
function fakeAuth(opts: {
  session?: { user: SessionUser } | null
  onHandler?: () => void
}): Auth {
  return {
    handler: async () => {
      opts.onHandler?.()
      return new Response(JSON.stringify({ handled: true }), {
        headers: { "content-type": "application/json" },
      })
    },
    api: {
      getSession: async () => opts.session ?? null,
    },
  } as unknown as Auth
}

const noDb = {} as Database
const user: SessionUser = {
  id: "user_1",
  email: "member@example.com",
  name: "Member",
  image: null,
}

describe("requireAuth guard on /me", () => {
  it("401s an unauthenticated request", async () => {
    const api = createApi({ db: noDb, auth: fakeAuth({ session: null }) })
    const res = await api.request("/me")
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
  })

  it("returns the authenticated user when a session exists", async () => {
    const api = createApi({ db: noDb, auth: fakeAuth({ session: { user } }) })
    const res = await api.request("/me")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user })
  })
})

describe("better-auth handler mount", () => {
  it("delegates /auth/* to better-auth", async () => {
    let handled = false
    const api = createApi({
      db: noDb,
      auth: fakeAuth({ session: null, onHandler: () => (handled = true) }),
    })
    const res = await api.request("/auth/sign-in/email", { method: "POST" })
    expect(handled).toBe(true)
    expect(await res.json()).toEqual({ handled: true })
  })
})
