import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { databaseUrl } from "./env.ts"

describe("databaseUrl", () => {
  const original = process.env.DATABASE_URL

  beforeEach(() => {
    delete process.env.DATABASE_URL
  })
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
  })

  it("returns the configured url", () => {
    process.env.DATABASE_URL = "postgres://alex:alex@localhost:5432/alex"
    expect(databaseUrl()).toBe("postgres://alex:alex@localhost:5432/alex")
  })

  it("throws a helpful error when unset", () => {
    expect(() => databaseUrl()).toThrow(/DATABASE_URL is not set/)
  })
})
