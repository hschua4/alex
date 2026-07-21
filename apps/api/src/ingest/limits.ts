import type { FileType } from "./extract.ts"

/**
 * Boundary caps (ADR-0011): rejected at the API edge before any work, so bad
 * input never reaches storage or burns ingestion retries. Sized per CONTEXT §5.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // 20 MB
export const MAX_PAGES = 300

const EXTENSION_TYPES: Record<string, FileType> = {
  pdf: "pdf",
  docx: "docx",
}

const MIME_TYPES: Record<string, FileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
}

/**
 * Resolve an accepted {@link FileType} from a filename + MIME type, or `null` if
 * unsupported. Extension wins (browsers are inconsistent about DOCX MIME), with
 * the MIME type as a fallback.
 */
export function resolveFileType(
  filename: string,
  mimeType: string | undefined,
): FileType | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_TYPES[ext] ?? (mimeType ? MIME_TYPES[mimeType] ?? null : null)
}

/** Normalize an unknown thrown value to a stored `error_message` string. */
export function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
