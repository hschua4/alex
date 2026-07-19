import { useQuery } from "@tanstack/react-query"

import { api } from "./api"

export type Health = {
  status: "ok" | "degraded"
  db: "up" | "down"
  schemaVersion?: string
  latencyMs: number
}

/** Poll the real `/api/health` RPC endpoint through the typed client. */
export function useHealth() {
  return useQuery<Health>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await api.health.$get()
      return (await res.json()) as Health
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}
