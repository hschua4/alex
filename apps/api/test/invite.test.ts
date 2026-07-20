import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  addInvite,
  consumeInvite,
  createDb,
  deleteInvite,
  isInvited,
  normalizeEmail,
  type Database,
} from "@alex/db"

/**
 * Invite-allowlist gate against a real Postgres (ADR-0012: the filter logic —
 * `consumed_at IS NULL` — is exactly what can't be meaningfully mocked). Needs
 * the dev/CI database up (`pnpm db:up`); defaults to the compose DSN when
 * DATABASE_URL is unset. Rows use unique emails and are cleaned up afterwards.
 */
const url = process.env.DATABASE_URL ?? "postgres://alex:alex@localhost:5434/alex"

describe("invite allowlist gate", () => {
  let db: Database
  let close: () => Promise<void>
  const created: string[] = []

  const uniqueEmail = (prefix: string) => {
    const email = `${prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}@invite.test`
    created.push(normalizeEmail(email))
    return email
  }

  beforeAll(() => {
    const conn = createDb(url, 1)
    db = conn.db
    close = conn.close
  })

  afterAll(async () => {
    for (const email of created) await deleteInvite(db, email)
    await close()
  })

  it("rejects an email that was never invited", async () => {
    const email = normalizeEmail(uniqueEmail("stranger"))
    expect(await isInvited(db, email)).toBe(false)
  })

  it("allows an invited email, then closes the gate once consumed", async () => {
    const email = normalizeEmail(uniqueEmail("invited"))
    await addInvite(db, email)
    expect(await isInvited(db, email)).toBe(true)

    // Consuming the invite (as sign-up does) means it can't grant a 2nd account.
    await consumeInvite(db, email)
    expect(await isInvited(db, email)).toBe(false)
  })

  it("normalises case/whitespace so the gate isn't bypassed by casing", async () => {
    const email = uniqueEmail("MixedCase")
    await addInvite(db, `  ${email.toUpperCase()}  `)
    expect(await isInvited(db, normalizeEmail(email))).toBe(true)
  })

  it("re-opens a consumed invite when the operator re-adds it", async () => {
    const email = normalizeEmail(uniqueEmail("returning"))
    await addInvite(db, email)
    await consumeInvite(db, email)
    expect(await isInvited(db, email)).toBe(false)

    await addInvite(db, email)
    expect(await isInvited(db, email)).toBe(true)
  })
})
