import mammoth from "mammoth"
import { extractText, getDocumentProxy } from "unpdf"

/**
 * Text extraction from an original file (CONTEXT §5). PDFs go through `unpdf`
 * (a serverless pdf.js build — no native canvas), giving per-page text so a
 * chunk can carry its source page. DOCX has no page model, so `mammoth` yields
 * one logical page. The extracted `pageCount` also feeds the ADR-0011 cap.
 */
export type FileType = "pdf" | "docx"

export type ExtractedPage = { page: number; text: string }

export type Extraction = {
  pages: ExtractedPage[]
  pageCount: number
}

/** Extract per-page text for chunking. */
export async function extractPages(
  bytes: Uint8Array,
  fileType: FileType,
): Promise<Extraction> {
  if (fileType === "pdf") return extractPdf(bytes)
  return extractDocx(bytes)
}

async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  // pdf.js transfers (detaches) the input ArrayBuffer, so hand it a copy — the
  // caller's bytes must survive (e.g. to be stored, or read again).
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = text.map((t, i) => ({ page: i + 1, text: t ?? "" }))
  return { pages, pageCount: totalPages }
}

async function extractDocx(bytes: Uint8Array): Promise<Extraction> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  // DOCX carries no page breaks we can trust; treat the whole doc as page 1.
  return { pages: [{ page: 1, text: value }], pageCount: 1 }
}

/**
 * Page count only, for the upload boundary (ADR-0011) — cheap enough to run
 * before enqueue so an over-cap PDF is rejected without burning ingestion work.
 * DOCX has no meaningful page count, so callers skip the page cap for it.
 */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  // Copy first: pdf.js detaches the buffer, and the upload route still needs
  // these bytes to store the original after the page-count check.
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  return pdf.numPages
}
