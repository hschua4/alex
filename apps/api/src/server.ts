import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

import { createDb, databaseUrl, markFailed } from "@alex/db"

import { createApi } from "./app.ts"
import { createAuth } from "./auth.ts"
import { createOpenRouterAnswerModel } from "./chat/index.ts"
import {
  createIngestQueue,
  createOpenAIEmbedder,
  createS3Store,
  errorMessageOf,
  ingestDocument,
} from "./ingest/index.ts"

const port = Number(process.env.PORT ?? 3000)
// Relative to the api package cwd; overridable for the Docker image layout.
const webDist = process.env.WEB_DIST ?? "../web/dist"

/** Fail fast at boot on a missing required secret rather than mid-upload. */
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}`)
  return value
}

const { db } = createDb()
const auth = createAuth(db)

// Original files → R2/S3 (ADR-0007). In dev `S3_ENDPOINT` points at MinIO with
// path-style routing; in prod it's unset and this hits real R2.
const store = createS3Store({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "auto",
  accessKeyId: required("S3_ACCESS_KEY_ID"),
  secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  bucket: required("S3_BUCKET"),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
})

// The embedding model is pinned (CONTEXT §7); the key is required so dev fails
// loudly if it's missing rather than silently indexing nothing.
const embedder = createOpenAIEmbedder({
  apiKey: required("OPENROUTER_API_KEY"),
  baseURL: process.env.EMBEDDING_BASE_URL,
  model: process.env.EMBEDDING_MODEL,
})

// The answer model is user-selectable from a server allowlist (ADR-0010), routed
// through OpenRouter on the same key. The route validates the id before calling.
const answerModel = createOpenRouterAnswerModel({
  apiKey: required("OPENROUTER_API_KEY"),
  baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
})

// Ingestion queue on the same Postgres (ADR-0006), worker in-process with a hard
// concurrency cap (INGEST_CONCURRENCY) so it can't starve chat latency.
const queue = createIngestQueue(databaseUrl())
await queue.start()
await queue.process({
  ingest: (documentId) => ingestDocument({ db, store, embedder }, documentId),
  onFinalFailure: (documentId, error) =>
    markFailed(db, documentId, errorMessageOf(error)),
})

const app = new Hono()

// The API lives under /api so httpOnly cookies and the SPA share one origin.
app.route(
  "/api",
  createApi({
    db,
    auth,
    store,
    enqueueIngest: queue.enqueue,
    embedder,
    answerModel,
  }),
)

// Static SPA assets, then a catch-all fallback to index.html for client routes.
app.use("/*", serveStatic({ root: webDist }))
app.get("*", serveStatic({ path: `${webDist}/index.html` }))

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`alex api listening on http://localhost:${info.port}`)
})

// Drain the queue and HTTP server on shutdown so in-flight jobs finish cleanly.
async function shutdown() {
  await queue.stop()
  server.close()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
