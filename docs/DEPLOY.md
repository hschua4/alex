# Deploying Alex

Alex runs as **one container** on the Skylab VPS at `alex.hschua.com`: the Hono
API serves the built SPA on the same origin and runs the ingestion worker
in-process (CONTEXT §6). It owns no Docker volume — originals live in R2
(ADR-0007) and everything else is in the shared Postgres — so the container is
disposable and a rollback is just a different image tag.

Skylab's design doc is the source of truth for the box itself:
`../../skylab/DEPLOYMENT.md`.

## Deploy artifacts in this repo

| Path | Purpose |
|---|---|
| [Dockerfile](../Dockerfile) | Multi-stage build: SPA build → pruned prod deps → runtime |
| [deploy/docker-compose.yml](../deploy/docker-compose.yml) | The stack, deployed to `/srv/alex/docker-compose.yml` |
| [deploy/.env.example](../deploy/.env.example) | Template for `/srv/alex/.env` |
| [.github/workflows/build.yml](../.github/workflows/build.yml) | Gate → build → push to GHCR → call deploy |
| [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) | Pull → migrate → swap over Tailscale SSH |

The dev [docker-compose.yml](../docker-compose.yml) at the repo root is
**dev-only** (local Postgres + MinIO) and is never deployed.

---

## 1. Prerequisites

### 1.1 Infra: swap the shared Postgres to pgvector

Alex needs the `vector` extension. This is a **one-time change to shared infra
that briefly restarts the database for all five apps** (skylab decision #25).

In the skylab repo, `docker-compose.yml` now pins `pgvector/pgvector:pg16` — a
drop-in superset of `postgres:16` with the same binaries and on-disk format, so
the existing `pgdata` volume and the other four databases carry over untouched.

```bash
cd /srv/infra
docker compose pull postgres
docker compose up -d postgres          # ~5–10s of DB downtime for every app
docker exec infra-postgres-1 psql -U postgres -c 'select version();'
```

Take a snapshot first if you want a cheap undo.

### 1.2 Infra: create the `alex` role, database, and extension

Add `ALEX_DB_PW` to `/srv/infra/.env`, then re-run the idempotent bootstrap:

```bash
cd /srv/infra
./postgres/bootstrap.sh
```

This creates the `alex` role + `alex` database and runs `CREATE EXTENSION IF NOT
EXISTS vector` **in the `alex` database as superuser**. That last step is not
optional: pgvector ships without `trusted = true` in its control file, so the
non-super `alex` role cannot create the extension itself, and
`0000_init.sql`'s `CREATE EXTENSION IF NOT EXISTS vector` would fail at migrate
time without it (skylab decision #26). With bootstrap having created it, the
migration is a no-op.

Verify:

```bash
docker exec infra-postgres-1 psql -U postgres -d alex -c '\dx vector'
```

### 1.3 R2 bucket for originals

Create a bucket (e.g. `alex-documents`) and an **R2 API token scoped to that
bucket only** — object read/write, no account-wide access. Note the account ID
for the endpoint URL.

### 1.4 DNS

Add a **proxied** `A` record `alex` → VPS IPv4 (and `AAAA` if the box has IPv6).
The existing Cloudflare Origin Cert's `*.hschua.com` SAN already covers
`alex.hschua.com`, so no new certificate is needed.

### 1.5 GitHub secrets on `hschua4/alex`

| Secret | Value |
|---|---|
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | Tailscale OAuth client with the `tag:ci` scope |
| `VPS_HOST` | The box's tailnet hostname or `100.x.y.z` address |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | Private key whose public half is in `deploy`'s `authorized_keys` |
| `VPS_SSH_KNOWN_HOSTS` | Output of `ssh-keyscan <tailnet-host>` — pins the host key so the deploy fails closed |

No application secrets go in GitHub: CI never holds prod credentials
(skylab decision #9).

---

## 2. First deploy

```bash
ssh deploy@<tailnet-host>
sudo install -d -o deploy -g deploy /srv/alex
cd /srv/alex
```

Copy `deploy/docker-compose.yml` from this repo to `/srv/alex/docker-compose.yml`
and `deploy/.env.example` to `/srv/alex/.env`, then fill it in:

```bash
chmod 600 /srv/alex/.env
chown deploy:deploy /srv/alex/.env
```

`DATABASE_URL` uses the service name on the shared network:
`postgres://alex:<ALEX_DB_PW>@postgres:5432/alex`.

Generate the auth secret with `openssl rand -base64 32`. Set
`BETTER_AUTH_URL=https://alex.hschua.com` and leave
`BETTER_AUTH_TRUSTED_ORIGINS` empty — prod is same-origin, so there is no
cross-subdomain cookie work of the kind Resitly needs (skylab decision #23).

Then, once CI has pushed a first image:

```bash
cd /srv/alex
docker compose pull alex
docker compose run --rm migrate     # creates the schema; must exit 0
docker compose up -d alex
docker compose logs -f alex
```

Grant yourself a sign-up — v1 is invite-only (ADR-0011):

```bash
docker compose run --rm invite add you@example.com
docker compose run --rm invite list
```

Smoke test: `https://alex.hschua.com/api/health` should return
`{"status":"ok","db":"up",…}`; then sign up, create a project, upload a PDF,
watch it reach `indexed`, and ask a question with citations.

---

## 3. Routine deploys

Push to `main`. [build.yml](../.github/workflows/build.yml) gates on
`typecheck` + `lint` + `test` (models are mocked — ADR-0012 — but the
integration tests do start a real pgvector container via Testcontainers), builds
the image, pushes `sha-<short>` and `latest` to
`ghcr.io/hschua4/alex`, then calls [deploy.yml](../.github/workflows/deploy.yml).

The deploy joins the tailnet as an ephemeral node, SSHes in as `deploy`, and:

1. Writes the tag into `/srv/alex/.env` as `ALEX_IMAGE_TAG`, so a later manual
   `docker compose up -d` can't silently drift back to `:latest`.
2. `docker compose pull alex`.
3. `docker compose run --rm migrate` — **the gate**. A non-zero exit stops the
   deploy with the old container still serving.
4. `docker compose up -d alex`, then polls the container health status.
5. Prunes images older than 24h, keeping yesterday's for a fast rollback.
6. Writes `/srv/alex/CURRENT_SHA`.

**Migrations must be expand/contract** (skylab decision #7). They run *before*
the swap, so the old code is briefly live against the new schema — never drop or
rename a column the running version still reads in the same deploy.

### Downtime

This is a plain `recreate`, so expect a few seconds of downtime — vanilla
Compose has no `start-first` strategy (skylab decision #8; Odin does the same).
The SIGTERM handler in [server.ts](../apps/api/src/server.ts) stops pg-boss
first, so an in-flight ingestion job finishes or is safely re-queued rather than
being lost. This is why the container runs the app as PID 1's direct child
(`node --import tsx`) instead of via `pnpm start`, which would fork and swallow
the signal.

### Rollback

```bash
gh workflow run deploy.yml -f tag=sha-abc1234
```

Rolls back code only. If the bad deploy included a migration, roll that back by
hand first — there is no down-migration path.

---

## 4. Operations

```bash
cd /srv/alex

docker compose logs -f alex               # tail (rotated at 10 MB × 3)
docker inspect -f '{{.State.Health.Status}}' alex
cat CURRENT_SHA
docker stats --no-stream alex             # tune mem_limit from real numbers

docker compose run --rm invite add someone@example.com
```

An unhealthy container is dropped from Traefik's load balancer automatically —
`/api/health` runs a real query and returns 503 when Postgres is unreachable.

Register `https://alex.hschua.com/api/health` with the uptime monitor alongside
the other hosts (skylab decision #12).

Alex needs no backup target of its own: its database is included in the nightly
`pg_dumpall`, and originals are in R2.

---

## 5. Known gaps

- **Memory headroom.** Alex's 512 m brings the box's committed total to ~2.82 GB
  of 4 GB. Watch `docker stats` for the first couple of weeks and trim before
  reaching for swap (skylab decision #13).
- **GitHub Actions are pinned to major version tags**, not commit SHAs. Pinning
  to full SHAs is the supply-chain hardening step; do it before treating this
  pipeline as trusted.
- **No app error monitoring** yet (CONTEXT §11.1) — health checks and logs only.
- **R2 lifecycle** is unset: deleting a document removes its chunks but the
  original object's cleanup has not been verified end to end on R2.
