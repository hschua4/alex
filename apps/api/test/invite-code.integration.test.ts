import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  addInvite,
  createDb,
  createInviteCode,
  inviteCode,
  revokeInviteCode,
  user,
  type Database,
} from "@alex/db"

import { createAuth, type Auth } from "../src/auth.ts"

/**
 * The invite-code gate against real Postgres and a real better-auth instance
 * (ADR-0013): a live code admits a sign-up and is recorded on the user; expired,
 * revoked, used-up, and missing codes are refused with distinct messages; the
 * email allowlist still works on its own; and a code's last use can't be spent
 * twice by racing sign-ups.
 */
const IMAGE = "pgvector/pgvector:pg16"
const migrationsFolder = fileURLToPath(
  new URL("../../../packages/db/drizzle", import.meta.url),
)

describe("invite codes (real Postgres + better-auth)", () => {
  let container: StartedPostgreSqlContainer
  let db: Database
  let close: () => Promise<void>
  let auth: Auth

  function signUp(inviteCode?: string, email = `${randomUUID()}@example.com`) {
    return auth.api.signUpEmail({
      body: { email, password: "password1234", name: "Reviewer", inviteCode },
    })
  }

  async function uses(code: string): Promise<number> {
    const [row] = await db
      .select({ uses: inviteCode.uses })
      .from(inviteCode)
      .where(eq(inviteCode.code, code))
    return row!.uses
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer(IMAGE).start()
    const conn = createDb(container.getConnectionUri(), 4)
    db = conn.db
    close = conn.close
    await migrate(db, { migrationsFolder })

    process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret"
    process.env.BETTER_AUTH_URL ??= "http://localhost:3000"
    auth = createAuth(db)
  }, 180_000)

  afterAll(async () => {
    await close?.()
    await container?.stop()
  })

  it("admits a sign-up with a live code and records it on the user", async () => {
    const { code } = await createInviteCode(db, { days: 7 })
    // Typed sloppily: lowercase, no dash.
    const res = await signUp(code.toLowerCase().replace("-", ""))

    const [row] = await db.select().from(user).where(eq(user.id, res.user.id))
    expect(row!.inviteCode).toBe(code)
    expect(await uses(code)).toBe(1)
  })

  it("a multi-use code admits up to its limit, then refuses", async () => {
    const { code } = await createInviteCode(db, { days: 7, maxUses: 2 })
    await signUp(code)
    await signUp(code)
    await expect(signUp(code)).rejects.toThrow(/already been used/)
    expect(await uses(code)).toBe(2)
  })

  it("refuses an expired code", async () => {
    const { code } = await createInviteCode(db, {
      days: 1,
      now: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    })
    await expect(signUp(code)).rejects.toThrow(/expired/)
    expect(await uses(code)).toBe(0)
  })

  it("refuses a revoked code", async () => {
    const { code } = await createInviteCode(db, { days: 7 })
    expect(await revokeInviteCode(db, code)).toBe(true)
    await expect(signUp(code)).rejects.toThrow(/revoked/)
  })

  it("refuses an unknown code, and a sign-up with no code at all", async () => {
    await expect(signUp("ZZZZ-ZZZZ")).rejects.toThrow(/isn't valid/)
    await expect(signUp()).rejects.toThrow(/invite-only/)
  })

  it("an allowlisted email still signs up without a code", async () => {
    const email = `${randomUUID()}@example.com`
    await addInvite(db, email)
    const res = await signUp(undefined, email)
    const [row] = await db.select().from(user).where(eq(user.id, res.user.id))
    expect(row!.inviteCode).toBeNull()
  })

  it("an existing account keeps working after its code expires", async () => {
    const { code } = await createInviteCode(db, { days: 7 })
    const email = `${randomUUID()}@example.com`
    await signUp(code, email)
    await db
      .update(inviteCode)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(inviteCode.code, code))

    const res = await auth.api.signInEmail({
      body: { email, password: "password1234" },
    })
    expect(res.user.email).toBe(email)
  })

  it("racing sign-ups can't both spend a code's last use", async () => {
    const { code } = await createInviteCode(db, { days: 7, maxUses: 1 })
    const results = await Promise.allSettled([
      signUp(code),
      signUp(code),
      signUp(code),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await uses(code)).toBe(1)
  })
})
