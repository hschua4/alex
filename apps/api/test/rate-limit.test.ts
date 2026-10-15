import { describe, expect, it } from "vitest"

import { createRateLimiter } from "../src/rate-limit.ts"

describe("createRateLimiter", () => {
  it("allows `limit` hits per window, then rejects with a retry hint", () => {
    let t = 0
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000, now: () => t })

    expect(limiter.take("a").ok).toBe(true)
    expect(limiter.take("a").ok).toBe(true)
    t = 4_000
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSec: 6 })
  })

  it("keys are independent", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000, now: () => 0 })
    expect(limiter.take("a").ok).toBe(true)
    expect(limiter.take("b").ok).toBe(true)
    expect(limiter.take("a").ok).toBe(false)
  })

  it("a new window resets the budget", () => {
    let t = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000, now: () => t })
    expect(limiter.take("a").ok).toBe(true)
    expect(limiter.take("a").ok).toBe(false)
    t = 10_000
    expect(limiter.take("a").ok).toBe(true)
  })
})
