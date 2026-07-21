import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

/**
 * Object storage for original uploaded files (ADR-0007). Originals live off-box
 * in R2 via the S3 API — the VPS disk fills fast and the nightly backup only
 * covers Postgres. The interface is small and injected, so routes and the worker
 * never bind to a concrete client: prod/dev use S3 (R2, or MinIO locally), tests
 * use an in-memory fake.
 */
export type ObjectStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<Uint8Array>
  delete(key: string): Promise<void>
}

export type S3StoreEnv = {
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  forcePathStyle?: boolean
}

/**
 * Build an {@link ObjectStore} backed by S3. In prod `endpoint` is unset (real
 * R2/S3); in dev it points at MinIO with `forcePathStyle` so bucket routing goes
 * through the path, not a subdomain the local endpoint can't resolve.
 */
export function createS3Store(env: S3StoreEnv): ObjectStore {
  const client = new S3Client({
    endpoint: env.endpoint,
    region: env.region,
    forcePathStyle: env.forcePathStyle ?? false,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  })
  const bucket = env.bucket

  return {
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      )
    },
    async get(key) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )
      if (!res.Body) throw new Error(`storage: empty body for ${key}`)
      return new Uint8Array(await res.Body.transformToByteArray())
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}

/**
 * In-memory {@link ObjectStore} for tests: no network, no MinIO. Holds bytes in a
 * Map keyed by object key, so a route test can `put` an original and the worker
 * `get` it back within the same process.
 */
export function createMemoryStore(): ObjectStore & { size: () => number } {
  const files = new Map<string, Uint8Array>()
  return {
    async put(key, bytes) {
      files.set(key, bytes)
    },
    async get(key) {
      const bytes = files.get(key)
      if (!bytes) throw new Error(`storage: no object at ${key}`)
      return bytes
    },
    async delete(key) {
      files.delete(key)
    },
    size: () => files.size,
  }
}
