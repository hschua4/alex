import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"

import {
  account,
  consumeInvite,
  isInvited,
  normalizeEmail,
  session,
  user,
  verification,
  type Database,
} from "@alex/db"

export type Auth = ReturnType<typeof createAuth>

/**
 * better-auth instance (ADR-0002): email/password with sessions in the same
 * Postgres and httpOnly same-origin cookies. Open signup is closed by an
 * invite-only gate (ADR-0011) enforced in the `user.create` hook below, so the
 * signup endpoint stays enabled but only allowlisted emails get through.
 *
 * Mounted under `/api/auth` by the Hono app; the web app talks to it same-origin
 * so there is no CORS and no bearer-token handling.
 */
export function createAuth(db: Database) {
  // Prod is same-origin (the API serves the SPA), so `baseURL` covers it. In dev
  // the Vite server is a different origin (:5173 → proxy → :3000); list it here
  // or better-auth's CSRF origin check rejects sign-in with "Invalid origin".
  const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)

  return betterAuth({
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    ...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),
    database: drizzleAdapter(db, {
      provider: "pg",
      // Model → table mapping; our column keys already match better-auth fields.
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      // Sign a user in immediately after a successful (invited) registration.
      autoSignIn: true,
    },
    databaseHooks: {
      user: {
        create: {
          // Invite gate: reject registration unless the email is allowlisted.
          before: async (creating) => {
            const email = normalizeEmail(String(creating.email))
            if (!(await isInvited(db, email))) {
              throw new APIError("FORBIDDEN", {
                code: "INVITE_REQUIRED",
                message:
                  "This email hasn't been invited. Alex is invite-only for now.",
              })
            }
          },
          // Burn the invite so it can't mint a second account.
          after: async (created) => {
            await consumeInvite(db, normalizeEmail(String(created.email)))
          },
        },
      },
    },
  })
}
