import PgBoss from "pg-boss"

/**
 * Async ingestion queue on the same Postgres (ADR-0006): durable across
 * restarts, retryable, concurrency-capped — no new infra. One job per document,
 * deduped by `singletonKey` so a re-ingest can't stack duplicate jobs; the work
 * itself is idempotent (delete-then-insert), so a retried or double-enqueued job
 * is harmless.
 */
const QUEUE_NAME = "ingest-document"
const RETRY_LIMIT = 3

type JobData = { documentId: string }

export type ProcessDeps = {
  /** Do the work; throw to signal failure (triggers a retry). */
  ingest: (documentId: string) => Promise<void>
  /** Called once retries are exhausted, to land the document in `failed`. */
  onFinalFailure: (documentId: string, error: unknown) => Promise<void>
}

export type IngestQueue = {
  start(): Promise<void>
  enqueue(documentId: string): Promise<void>
  process(deps: ProcessDeps): Promise<void>
  stop(): Promise<void>
}

/**
 * Build the ingestion queue over `connectionString`. pg-boss manages its own
 * schema in this database on {@link start}.
 */
export function createIngestQueue(connectionString: string): IngestQueue {
  const boss = new PgBoss(connectionString)

  return {
    async start() {
      await boss.start()
      await boss.createQueue(QUEUE_NAME)
    },

    async enqueue(documentId) {
      // singletonKey collapses concurrent enqueues for the same doc into one
      // pending job; retryBackoff spaces out transient-failure retries.
      await boss.send(
        QUEUE_NAME,
        { documentId } satisfies JobData,
        { singletonKey: documentId, retryLimit: RETRY_LIMIT, retryBackoff: true },
      )
    },

    async process({ ingest, onFinalFailure }) {
      // One worker per concurrency slot, each pulling a single job — the hard cap
      // that keeps embedding from starving chat latency (CONTEXT §1). Per-job
      // fetch also gives clean per-document retry semantics.
      const concurrency = Math.max(1, Number(process.env.INGEST_CONCURRENCY ?? 1))
      for (let i = 0; i < concurrency; i++) {
        await boss.work<JobData>(
          QUEUE_NAME,
          { batchSize: 1, includeMetadata: true },
          async (jobs) => {
            const job = jobs[0]
            if (!job) return
            const { documentId } = job.data
            try {
              await ingest(documentId)
            } catch (err) {
              // Last attempt: record the failure and let the job complete, so it
              // doesn't loop. Otherwise rethrow for pg-boss to retry.
              if (job.retryCount >= job.retryLimit) {
                await onFinalFailure(documentId, err)
                return
              }
              throw err
            }
          },
        )
      }
    },

    async stop() {
      await boss.stop()
    },
  }
}
