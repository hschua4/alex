import { parseArgs } from "node:util"

import {
  addInvite,
  createDb,
  createInviteCode,
  listInviteCodes,
  listInvites,
  normalizeEmail,
  revokeInviteCode,
  type InviteCode,
} from "@alex/db"

/**
 * Operator CLI for the invite gate (ADR-0011, ADR-0013) — the only ways in
 * while v1 is invite-only.
 *
 *   pnpm invite add <email>        # allowlist an email (idempotent, re-opens if consumed)
 *   pnpm invite list               # show email invites
 *   pnpm invite code [--days 7] [--uses 1] [--label "Acme interview"]
 *                                  # mint a shareable code that expires
 *   pnpm invite codes              # show codes with their status
 *   pnpm invite revoke <code>      # stop a code granting further sign-ups
 */
const USAGE = `usage:
  pnpm invite add <email>
  pnpm invite list
  pnpm invite code [--days 7] [--uses 1] [--label "Acme interview"]
  pnpm invite codes
  pnpm invite revoke <code>`

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      days: { type: "string", default: "7" },
      uses: { type: "string", default: "1" },
      label: { type: "string" },
    },
  })
  const [command, arg] = positionals
  const { db, close } = createDb()

  try {
    if (command === "add") {
      if (!arg) throw new Error("usage: pnpm invite add <email>")
      await addInvite(db, arg)
      console.log(`Invited ${normalizeEmail(arg)}.`)
    } else if (command === "list") {
      const rows = await listInvites(db)
      if (rows.length === 0) {
        console.log("No invites yet. Add one with `pnpm invite add <email>`.")
      } else {
        for (const row of rows) {
          const status = row.consumedAt
            ? `consumed ${row.consumedAt.toISOString()}`
            : "pending"
          console.log(`${row.email.padEnd(32)} ${status}`)
        }
      }
    } else if (command === "code") {
      const days = positiveInt(values.days, "--days")
      const maxUses = positiveInt(values.uses, "--uses")
      const row = await createInviteCode(db, {
        days,
        maxUses,
        label: values.label,
      })
      const base = process.env.BETTER_AUTH_URL ?? "http://localhost:5173"
      console.log(`Invite code: ${row.code}`)
      console.log(
        `Good for ${maxUses} sign-up${maxUses === 1 ? "" : "s"} until ${row.expiresAt.toISOString()}.`,
      )
      console.log(`Sign-up link: ${base}/login?code=${row.code}`)
    } else if (command === "codes") {
      const rows = await listInviteCodes(db)
      if (rows.length === 0) {
        console.log("No codes yet. Mint one with `pnpm invite code`.")
      } else {
        for (const row of rows) {
          console.log(
            `${row.code}  ${codeStatus(row).padEnd(10)} ${`${row.uses}/${row.maxUses} used`.padEnd(10)} ` +
              `expires ${row.expiresAt.toISOString()}  ${row.label ?? ""}`,
          )
        }
      }
    } else if (command === "revoke") {
      if (!arg) throw new Error("usage: pnpm invite revoke <code>")
      const revoked = await revokeInviteCode(db, arg)
      console.log(revoked ? `Revoked ${arg}.` : `No live code matches ${arg}.`)
    } else {
      console.error(USAGE)
      process.exitCode = 1
    }
  } finally {
    await close()
  }
}

function positiveInt(value: string | undefined, flag: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive whole number`)
  }
  return n
}

function codeStatus(row: InviteCode): string {
  if (row.revokedAt) return "revoked"
  if (row.expiresAt <= new Date()) return "expired"
  if (row.uses >= row.maxUses) return "used up"
  return "live"
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
