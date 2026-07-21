import { sql } from "drizzle-orm"
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
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

/**
 * A project is a user-owned workspace that will hold documents and chat sessions
 * (CONTEXT.md §3, ADR-0001). This is the first product table: every row carries
 * a `userId`, and every query filters by it — access to a project is authorized
 * against the authenticated user, never inferred from the id alone.
 *
 * The doc/chat counts the dashboard shows are *derived* from the (later) document
 * and chat_session tables, not stored here, so they can't drift from reality.
 * `userId` is not a foreign key on purpose: the `user` table is owned by
 * better-auth (see below), so we scope by value and let auth own its own schema.
 */
export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  // The list endpoint filters every read by owner; index it.
  (t) => [index("project_user_id_idx").on(t.userId)],
)

export type Project = typeof project.$inferSelect
export type NewProject = typeof project.$inferInsert

/**
 * Auth tables owned by better-auth (ADR-0002). Column keys are camelCase to
 * match better-auth's model fields — the drizzle adapter maps its models onto
 * these tables by property name. These are managed via better-auth's contract;
 * change them only alongside a better-auth config/schema change.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})

/**
 * Invite allowlist for the invite-only gate (ADR-0011). A row keyed by email
 * grants exactly one sign-up; `consumedAt` is stamped when that email registers,
 * so an invite can't be reused. Rows are added out-of-band by an operator
 * (`pnpm invite <email>`), never through open signup.
 */
export const invite = pgTable("invite", {
  email: text("email").primaryKey(),
  invitedBy: text("invited_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
})

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
export type Invite = typeof invite.$inferSelect
