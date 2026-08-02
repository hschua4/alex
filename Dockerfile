# Alex production image — one container serving the built SPA, the Hono API, and
# the in-process ingestion worker (CONTEXT §6, §8).
#
# Built in CI and pushed to GHCR; the 4 GB VPS never builds (DEPLOYMENT.md #3).
# The runtime layout mirrors the dev workspace exactly (`apps/api` next to
# `apps/web/dist`) so `WEB_DIST`'s default of `../web/dist` resolves unchanged.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — full workspace install, cached on the manifests alone so a source-only
# change does not re-resolve the dependency graph.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build — compile the SPA. Only `apps/web/dist` is carried forward.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter @alex/web build

# ---------------------------------------------------------------------------
# prod-deps — the runtime dependency tree only: @alex/api and what it depends
# on (@alex/db). The web package's build-only toolchain is never installed.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile --prod --filter "@alex/api..."

# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000

# node_modules are copied to the same absolute paths they were installed at, so
# pnpm's relative symlinks into the `.pnpm` store stay valid.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/db/node_modules ./packages/db/node_modules

COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY packages/db/package.json ./packages/db/
COPY packages/db/src ./packages/db/src
# The migrator resolves `../drizzle` from its own file URL — these SQL files are
# the deploy-time migration gate (DEPLOYMENT.md #7), so they must ship.
COPY packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist

USER node
WORKDIR /app/apps/api
EXPOSE 3000

# Same shallow DB-touching check the UI polls; returns 503 when Postgres is
# unreachable, which drops the container out of Traefik's load balancer.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

# `node --import tsx` keeps the app as PID 1's direct child, so the SIGTERM
# handler in server.ts actually runs and drains pg-boss before exit. Launching
# through `pnpm start` or the `tsx` CLI would fork and swallow the signal.
CMD ["node", "--import", "tsx", "src/server.ts"]
