import { addInvite, createDb, listInvites, normalizeEmail } from "@alex/db"

/**
 * Operator CLI for the invite allowlist (ADR-0011) — the only way an email is
 * granted a sign-up while v1 is invite-only.
 *
 *   pnpm invite add <email>   # allowlist an email (idempotent, re-opens if consumed)
 *   pnpm invite list          # show pending + consumed invites
 */
async function main() {
  const [command, email] = process.argv.slice(2)
  const { db, close } = createDb()

  try {
    if (command === "add") {
      if (!email) throw new Error("usage: pnpm invite add <email>")
      await addInvite(db, email)
      console.log(`Invited ${normalizeEmail(email)}.`)
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
    } else {
      console.error("usage:\n  pnpm invite add <email>\n  pnpm invite list")
      process.exitCode = 1
    }
  } finally {
    await close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
