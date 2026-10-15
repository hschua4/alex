import { inferAdditionalFields } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/**
 * better-auth browser client (ADR-0002). Same-origin: the API is served under
 * `/api` on this host (the Vite dev proxy mirrors prod), so the session rides an
 * httpOnly cookie and there is no CORS or token handling here.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  // Mirrors the server's `user.additionalFields` so `signUp.email` accepts the
  // invite code (ADR-0013).
  plugins: [
    inferAdditionalFields({
      user: { inviteCode: { type: "string", required: false, input: true } },
    }),
  ],
})

export const { signIn, signUp, signOut, useSession } = authClient
