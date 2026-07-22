/**
 * Decorative palettes + type aliases shared by the UI shell.
 *
 * Projects, documents, and chat have all moved to the live API
 * (`lib/projects.ts`, `lib/documents.ts`, `lib/chat.ts`). What remains here is
 * presentation-only: the file-type/status enums and the decorative tints the
 * badges render in — data with no server counterpart.
 */

export type DocType = "PDF" | "DOCX"
export type DocStatus = "indexed" | "processing" | "failed"

/** Decorative per-hue tint used for project icons and file-type badges. */
export type Tint = { bg: string; fg: string }

// ── decorative palettes ─────────────────────────────────────────────────────

export const DOC_TINTS: Record<DocType, Tint> = {
  PDF: { bg: "oklch(0.94 0.05 25)", fg: "oklch(0.5 0.19 25)" },
  DOCX: { bg: "oklch(0.93 0.04 245)", fg: "oklch(0.48 0.17 245)" },
}

export const STATUS_META: Record<
  DocStatus,
  { label: string; colorVar: string }
> = {
  indexed: { label: "Indexed", colorVar: "var(--success)" },
  processing: { label: "Processing", colorVar: "var(--warning)" },
  failed: { label: "Failed", colorVar: "var(--destructive)" },
}
