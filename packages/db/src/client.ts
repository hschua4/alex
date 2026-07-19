import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { databaseUrl } from "./env.ts"
import * as schema from "./schema.ts"

export type Database = ReturnType<typeof createDb>["db"]

/**
 * Create a Drizzle client plus its underlying postgres-js connection. The API
 * owns a single long-lived instance; scripts and tests create throwaway ones
 * and `close()` when done.
 */
export function createDb(url: string = databaseUrl(), max = 10) {
  const sql = postgres(url, { max })
  const db = drizzle(sql, { schema })
  return { db, sql, close: () => sql.end() }
}
