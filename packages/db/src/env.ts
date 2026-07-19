/** Resolve the Postgres connection string, failing loudly if it is missing. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example and start the dev database with `docker compose up -d db`.",
    )
  }
  return url
}
