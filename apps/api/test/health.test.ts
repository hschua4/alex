import { describe, expect, it } from "vitest"

import type { Database } from "@alex/db"

import { createApi } from "../src/app.ts"
import { fakeEmbed, mockAnswerModel } from "./mocks/models.ts"

/** Minimal fake Database: only the `select().from().where()` chain the health route uses. */
function fakeDb(rows: Array<{ key: string; value: string }>): Database {
  const chain = {
    from: () => chain,
    where: async () => rows,
  }
  return { select: () => chain } as unknown as Database
}

describe("GET /api/health", () => {
  it("reports ok with the schema version when the db responds", async () => {
    const api = createApi({
      db: fakeDb([{ key: "schema_version", value: "0001" }]),
    })
    const res = await api.request("/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      status: "ok",
      db: "up",
      schemaVersion: "0001",
    })
  })

  it("reports degraded (503) when the db query throws", async () => {
    const brokenDb = {
      select: () => ({
        from: () => ({
          where: async () => {
            throw new Error("connection refused")
          },
        }),
      }),
    } as unknown as Database
    const api = createApi({ db: brokenDb })
    const res = await api.request("/health")
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ status: "degraded", db: "down" })
  })
})

describe("model mock harness", () => {
  it("produces deterministic fake embeddings", () => {
    expect(fakeEmbed("hello")).toEqual(fakeEmbed("hello"))
    expect(fakeEmbed("hello")).not.toEqual(fakeEmbed("world"))
    expect(fakeEmbed("hello")).toHaveLength(1536)
  })

  it("constructs a mock answer model", () => {
    expect(mockAnswerModel()).toBeDefined()
  })
})
