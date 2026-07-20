import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

import { createDb } from "@alex/db"

import { createApi } from "./app.ts"
import { createAuth } from "./auth.ts"

const port = Number(process.env.PORT ?? 3000)
// Relative to the api package cwd; overridable for the Docker image layout.
const webDist = process.env.WEB_DIST ?? "../web/dist"

const { db } = createDb()
const auth = createAuth(db)

const app = new Hono()

// The API lives under /api so httpOnly cookies and the SPA share one origin.
app.route("/api", createApi({ db, auth }))

// Static SPA assets, then a catch-all fallback to index.html for client routes.
app.use("/*", serveStatic({ root: webDist }))
app.get("*", serveStatic({ path: `${webDist}/index.html` }))

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`alex api listening on http://localhost:${info.port}`)
})
