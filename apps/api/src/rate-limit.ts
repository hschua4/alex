/**
 * Fixed-window rate limiter (ADR-0011), in memory. Alex runs as one container,
 * so a process-local counter is exact for concurrent requests — unlike counting
 * persisted messages, which only land once a stream finishes. A restart resets
 * the counters, which is acceptable for abuse control.
 *
 * Pure apart from the injected clock, so it unit-tests without timers.
 */
export type RateLimiter = {
  /** Count one hit against `key`; `ok: false` once the window's budget is spent. */
  take(key: string): { ok: true } | { ok: false; retryAfterSec: number }
}

export function createRateLimiter(options: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const { limit, windowMs } = options
  const now = options.now ?? Date.now
  const windows = new Map<string, { start: number; count: number }>()

  return {
    take(key) {
      const t = now()
      let w = windows.get(key)
      if (!w || t - w.start >= windowMs) {
        // Lazily drop stale windows so the map can't grow without bound.
        if (windows.size > 10_000) {
          for (const [k, v] of windows) {
            if (t - v.start >= windowMs) windows.delete(k)
          }
        }
        w = { start: t, count: 0 }
        windows.set(key, w)
      }
      if (w.count >= limit) {
        return {
          ok: false,
          retryAfterSec: Math.ceil((w.start + windowMs - t) / 1000),
        }
      }
      w.count++
      return { ok: true }
    },
  }
}
