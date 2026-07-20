import { and, desc, eq, isNull } from "drizzle-orm"

import type { Database } from "./client.ts"
import { invite, type Invite } from "./schema.ts"

/**
 * Invite-allowlist queries (ADR-0011). These live in the db package so the
 * query builders (`eq`/`and`/…) and the table objects come from one drizzle-orm
 * instance — importing them across package boundaries produces two peer-variant
 * copies whose column types don't unify.
 */

/** Normalise an email for allowlist lookups (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * True when `email` has an unconsumed invite — the whole invite-only gate: no
 * matching row → no sign-up. `email` must already be normalised.
 */
export async function isInvited(
  db: Database,
  email: string,
): Promise<boolean> {
  const [row] = await db
    .select({ email: invite.email })
    .from(invite)
    .where(and(eq(invite.email, email), isNull(invite.consumedAt)))
    .limit(1)
  return Boolean(row)
}

/**
 * Stamp the invite for `email` as consumed so it can't grant a second account.
 * Idempotent: only unconsumed rows are touched. `email` must be normalised.
 */
export async function consumeInvite(
  db: Database,
  email: string,
): Promise<void> {
  await db
    .update(invite)
    .set({ consumedAt: new Date() })
    .where(and(eq(invite.email, email), isNull(invite.consumedAt)))
}

/** Add (or re-open) an invite for `email`. Operator action, never user-facing. */
export async function addInvite(
  db: Database,
  email: string,
  invitedBy?: string,
): Promise<void> {
  const normalized = normalizeEmail(email)
  await db
    .insert(invite)
    .values({ email: normalized, invitedBy })
    .onConflictDoUpdate({
      target: invite.email,
      set: { consumedAt: null, invitedBy },
    })
}

/** All invites, newest first — for the operator CLI. */
export async function listInvites(db: Database): Promise<Invite[]> {
  return db.select().from(invite).orderBy(desc(invite.createdAt))
}

/** Remove an invite row entirely. Used by integration tests to clean up. */
export async function deleteInvite(db: Database, email: string): Promise<void> {
  await db.delete(invite).where(eq(invite.email, normalizeEmail(email)))
}
