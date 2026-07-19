import { sql } from "drizzle-orm"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * Walking-skeleton schema.
 *
 * `app_meta` is a single-row table the health route reads to prove a real query
 * flows web → api → Postgres. Product tables (project, document, chunk, …) land
 * in later slices; the vector extension is enabled now (ADR-0008) so the HNSW
 * index has somewhere to live when retrieval arrives.
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})

export type AppMeta = typeof appMeta.$inferSelect
