import { randomInt } from "node:crypto"

import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm"

import type { Database } from "./client.ts"
import {
  invite,
  inviteCode,
  type Invite,
  type InviteCode,
} from "./schema.ts"

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

// ── invite codes (ADR-0013) ─────────────────────────────────────────────────

/** Crockford-style alphabet: no I/L/O/0/1, so a code survives being read aloud. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

/** A fresh `XXXX-XXXX` code: 8 symbols from 31, ~40 bits — not guessable. */
export function generateInviteCode(): string {
  let raw = ""
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/**
 * Canonicalise user input to the stored `XXXX-XXXX` form: case, spaces, and
 * the dash are all forgiven. Anything that isn't 8 symbols is left as-is (and
 * simply won't match).
 */
export function normalizeInviteCode(code: string): string {
  const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
}

/** Mint a code valid for `days`, good for `maxUses` sign-ups. Operator action. */
export async function createInviteCode(
  db: Database,
  input: { days: number; maxUses?: number; label?: string; now?: Date },
): Promise<InviteCode> {
  const now = input.now ?? new Date()
  const [row] = await db
    .insert(inviteCode)
    .values({
      code: generateInviteCode(),
      label: input.label,
      maxUses: input.maxUses ?? 1,
      expiresAt: new Date(now.getTime() + input.days * 24 * 60 * 60 * 1000),
    })
    .returning()
  if (!row) throw new Error("createInviteCode: insert returned no row")
  return row
}

export type InviteCodeRejection = "not_found" | "revoked" | "expired" | "used_up"

/**
 * Spend one use of `code`, atomically: a single conditional UPDATE, so two
 * sign-ups racing for a code's last use can't both win. On refusal, a second
 * read says why, so the sign-up form can show a useful message. `code` must
 * already be normalised.
 */
export async function claimInviteCode(
  db: Database,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: InviteCodeRejection }> {
  const claimed = await db
    .update(inviteCode)
    .set({ uses: sql`${inviteCode.uses} + 1` })
    .where(
      and(
        eq(inviteCode.code, code),
        isNull(inviteCode.revokedAt),
        gt(inviteCode.expiresAt, sql`now()`),
        lt(inviteCode.uses, inviteCode.maxUses),
      ),
    )
    .returning({ code: inviteCode.code })
  if (claimed.length > 0) return { ok: true }

  const [row] = await db
    .select()
    .from(inviteCode)
    .where(eq(inviteCode.code, code))
    .limit(1)
  if (!row) return { ok: false, reason: "not_found" }
  if (row.revokedAt) return { ok: false, reason: "revoked" }
  if (row.expiresAt <= new Date()) return { ok: false, reason: "expired" }
  return { ok: false, reason: "used_up" }
}

/** All codes, newest first — for the operator CLI. */
export async function listInviteCodes(db: Database): Promise<InviteCode[]> {
  return db.select().from(inviteCode).orderBy(desc(inviteCode.createdAt))
}

/** Revoke a code so it grants no further sign-ups. True if a live code matched. */
export async function revokeInviteCode(
  db: Database,
  code: string,
): Promise<boolean> {
  const rows = await db
    .update(inviteCode)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(inviteCode.code, normalizeInviteCode(code)),
        isNull(inviteCode.revokedAt),
      ),
    )
    .returning({ code: inviteCode.code })
  return rows.length > 0
}
