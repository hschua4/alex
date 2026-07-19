import { hc } from "hono/client"

import type { AppType } from "@alex/api"

/**
 * The typed Hono RPC client — the real end of the `mock-data.ts` seam
 * (ADR-0009). Base is same-origin `/api`; in dev the Vite proxy forwards it to
 * the API server. Product accessors move here from `mock-data.ts` slice by
 * slice; today it carries one real call: the health check.
 */
export const api = hc<AppType>("/api")
