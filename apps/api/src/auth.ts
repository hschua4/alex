import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"

import {
  account,
  claimInviteCode,
  consumeInvite,
  isInvited,
  normalizeEmail,
  normalizeInviteCode,
  session,
  user,
  verification,
  type Database,
  type InviteCodeRejection,
} from "@alex/db"

export type Auth = ReturnType<typeof createAuth>

/** What the sign-up form shows for each refused invite code (ADR-0013). */
const CODE_REJECTION_MESSAGE: Record<InviteCodeRejection, string> = {
  not_found: "That invite code isn't valid. Check it and try again.",
  revoked: "That invite code has been revoked.",
  expired: "That invite code has expired. Ask for a new one.",
  used_up: "That invite code has already been used.",
}

/**
 * better-auth instance (ADR-0002): email/password with sessions in the same
 * Postgres and httpOnly same-origin cookies. Open signup is closed by an
 * invite-only gate (ADR-0011) enforced in the `user.create` hook below, so the
 * signup endpoint stays enabled but only invited people get through: either the
 * email is allowlisted, or the form carries a live invite code (ADR-0013).
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
    user: {
      // The invite code a registrant typed (ADR-0013). It arrives in the sign-up
      // body and is validated + claimed in the `user.create.before` hook below;
      // what's stored is provenance, never an access check.
      additionalFields: {
        inviteCode: { type: "string", required: false, input: true },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Sign a user in immediately after a successful (invited) registration.
      autoSignIn: true,
    },
    databaseHooks: {
      user: {
        create: {
          // Invite gate: an allowlisted email gets in as before; otherwise the
          // sign-up must carry an invite code, which is claimed atomically here
          // so its last use can't be spent twice.
          before: async (creating) => {
            const email = normalizeEmail(String(creating.email))
            if (await isInvited(db, email)) {
              return { data: { ...creating, inviteCode: null } }
            }

            const typed = creating.inviteCode
            if (typeof typed !== "string" || typed.trim() === "") {
              throw new APIError("FORBIDDEN", {
                code: "INVITE_REQUIRED",
                message:
                  "Alex is invite-only for now. Enter the invite code you were given.",
              })
            }
            const code = normalizeInviteCode(typed)
            const claim = await claimInviteCode(db, code)
            if (!claim.ok) {
              throw new APIError("FORBIDDEN", {
                code: "INVITE_CODE_INVALID",
                message: CODE_REJECTION_MESSAGE[claim.reason],
              })
            }
            return { data: { ...creating, inviteCode: code } }
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
