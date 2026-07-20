import { createAuthClient } from "better-auth/react"

/**
 * better-auth browser client (ADR-0002). Same-origin: the API is served under
 * `/api` on this host (the Vite dev proxy mirrors prod), so the session rides an
 * httpOnly cookie and there is no CORS or token handling here.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
})

export const { signIn, signUp, signOut, useSession } = authClient
