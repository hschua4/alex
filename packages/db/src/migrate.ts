import { fileURLToPath } from "node:url"

import { migrate } from "drizzle-orm/postgres-js/migrator"

import { createDb } from "./client.ts"

/** Apply all pending migrations from ./drizzle, then exit. */
async function main() {
  const { db, close } = createDb()
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))
  console.log(`Applying migrations from ${migrationsFolder} …`)
  await migrate(db, { migrationsFolder })
  console.log("Migrations applied.")
  await close()
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
