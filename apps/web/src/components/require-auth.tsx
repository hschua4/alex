import { Loader2 } from "lucide-react"
import { Navigate, Outlet, useLocation } from "react-router-dom"

import { useSession } from "@/lib/auth-client"

/**
 * Route guard (ADR-0001/ADR-0002): gates the app behind a valid session.
 * Unauthenticated visitors are redirected to /login; the session is the httpOnly
 * cookie better-auth manages, so this only reads state, never a token.
 */
export function RequireAuth() {
  const { data: session, isPending } = useSession()
  const location = useLocation()

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
