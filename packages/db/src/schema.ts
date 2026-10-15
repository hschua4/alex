import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  vector,
} from "drizzle-orm/pg-core"

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
 * Ingestion lifecycle (CONTEXT §5, ADR-0006). A row is born `processing`: the
 * original is stored in R2 *before* the row exists, so there is no `uploading`
 * state to model here. Retrieval only ever sees `indexed` rows, so a processing
 * or failed document is never half-searched.
 */
export const documentStatus = pgEnum("document_status", [
  "processing",
  "indexed",
  "failed",
])

/**
 * A document is an uploaded file (PDF/DOCX) inside a project (CONTEXT §3). The
 * original bytes live in R2 (`storageKey`, ADR-0007); this row tracks the
 * ingestion `status` and, on failure, a surfaced `errorMessage`. Like every
 * product table it carries `userId` and is scoped by it directly — a document id
 * alone never authorizes access. `pageCount` is captured at the boundary (the
 * ADR-0011 page cap) and reused by the UI.
 */
export const document = pgTable(
  "document",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    filename: text("filename").notNull(),
    fileType: text("file_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count").notNull(),
    storageKey: text("storage_key").notNull(),
    status: documentStatus("status").notNull().default("processing"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  // The list endpoint reads by owner within a project; the dashboard counts by
  // owner. One composite index serves both.
  (t) => [index("document_user_project_idx").on(t.userId, t.projectId)],
)

export type Document = typeof document.$inferSelect
export type NewDocument = typeof document.$inferInsert

/**
 * A chunk is a ~600-token slice of a document — the unit of retrieval (CONTEXT
 * §3, ADR-0004). It stores the text, its 1536-d embedding, and provenance (page,
 * char offset, chunk index) so a citation can point back to the source passage.
 *
 * `UNIQUE(document_id, chunk_index)` is a belt-and-suspenders guard on the
 * idempotent delete-then-insert re-ingestion (ADR-0006); the HNSW index over the
 * embedding (cosine ops) backs top-k retrieval (ADR-0008). Chunks cascade-delete
 * with their document.
 */
export const chunk = pgTable(
  "chunk",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    page: integer("page").notNull(),
    charOffset: integer("char_offset").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique("chunk_document_id_chunk_index_uq").on(t.documentId, t.chunkIndex),
    index("chunk_embedding_hnsw_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
)

export type Chunk = typeof chunk.$inferSelect
export type NewChunk = typeof chunk.$inferInsert

/**
 * A chat session is a conversation within a project (CONTEXT §3). Like every
 * product table it carries `userId` and is scoped by it directly; it cascades
 * with its project. The `title` is seeded from the first user message.
 */
export const chatSession = pgTable(
  "chat_session",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  // The history sidebar lists a project's sessions by owner, newest first.
  (t) => [index("chat_session_user_project_idx").on(t.userId, t.projectId)],
)

export type ChatSession = typeof chatSession.$inferSelect

export const messageRole = pgEnum("message_role", ["user", "assistant"])

/**
 * A message's terminal state (CONTEXT §4.6). User turns and finished answers are
 * `complete`; a cancelled stream is kept as `stopped`; a generation that errored
 * after the user turn was persisted is `failed`. Provenance survives either way.
 */
export const messageStatus = pgEnum("message_status", [
  "complete",
  "stopped",
  "failed",
])

/** Token accounting stored on an assistant message (CONTEXT §3, provenance). */
export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * One turn in a session (CONTEXT §3). The user turn is persisted *before*
 * retrieval so provenance survives a failed generation (CONTEXT §4.2); it records
 * the `selectedDocumentIds` retrieval was scoped to *that turn*. The assistant
 * turn records the `modelId` that produced it and its `tokenUsage` — provenance
 * is stored, not derived. Messages cascade with their session.
 */
export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSession.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    status: messageStatus("status").notNull().default("complete"),
    // The per-turn document scope (ADR-0003). Set on user turns; empty otherwise.
    selectedDocumentIds: text("selected_document_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    // The answer model + accounting (ADR-0010). Null on user turns.
    modelId: text("model_id"),
    tokenUsage: jsonb("token_usage").$type<TokenUsage>(),
    // Regenerate is additive (CONTEXT §4.6): a re-answer is a *new* assistant
    // message pointing at the one it supersedes, never a destructive overwrite —
    // so the original answer survives and history stays honest. Null on originals
    // and every user turn; a soft self-reference (no FK) so a later prune of an
    // old answer can't orphan the chain.
    regeneratedFrom: text("regenerated_from"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  // Rendering a session reads its messages in creation order.
  (t) => [index("message_session_idx").on(t.sessionId, t.createdAt)],
)

export type Message = typeof message.$inferSelect
export type NewMessage = typeof message.$inferInsert

/**
 * A numbered `[n]` citation on an assistant message (CONTEXT §3, ADR-0005).
 * Numbering is per-answer and ephemeral. The snippet, document name, and location
 * are *snapshotted at answer time* so history renders faithfully even if the
 * source document is later re-indexed or deleted — `chunkId` is a soft reference
 * (nullable, no FK), kept only for a future jump-to-source.
 */
export const messageCitation = pgTable(
  "message_citation",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    chunkId: text("chunk_id"),
    documentId: text("document_id").notNull(),
    documentName: text("document_name").notNull(),
    page: integer("page").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    snippet: text("snippet").notNull(),
  },
  (t) => [
    unique("message_citation_message_id_n_uq").on(t.messageId, t.n),
    index("message_citation_message_idx").on(t.messageId),
  ],
)

export type MessageCitation = typeof messageCitation.$inferSelect
export type NewMessageCitation = typeof messageCitation.$inferInsert

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
  // The invite code this account registered with (ADR-0013), or null for an
  // email-allowlist invite. Provenance only: the code's expiry gates sign-up,
  // never an existing account. A better-auth `additionalFields` input.
  inviteCode: text("invite_code"),
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

/**
 * Shareable invite codes (ADR-0013) — the alternative to allowlisting an email
 * when the operator doesn't know who will sign up (e.g. an interview panel).
 * A code grants up to `maxUses` sign-ups until `expiresAt`; `uses` is claimed
 * atomically at registration. Expiry stops new sign-ups only — accounts already
 * created keep full access. Minted by an operator (`pnpm invite code`).
 */
export const inviteCode = pgTable("invite_code", {
  code: text("code").primaryKey(),
  label: text("label"),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
export type Invite = typeof invite.$inferSelect
export type InviteCode = typeof inviteCode.$inferSelect
