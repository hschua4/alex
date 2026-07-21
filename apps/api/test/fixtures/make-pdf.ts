import { PDFDocument, StandardFonts } from "pdf-lib"

/**
 * Build a real, valid PDF with one page per string in `pages` — enough for
 * `unpdf` to extract the drawn text. Used by the ingestion integration test
 * (real extract → chunk → embed → index) and the over-page boundary test.
 */
export async function makePdf(pages: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    const page = pdf.addPage([612, 792])
    // Wrap crudely so long fixture text stays on the page.
    const lines = text.match(/.{1,90}(\s|$)/g) ?? [text]
    lines.forEach((line, i) => {
      page.drawText(line.trimEnd(), { x: 50, y: 740 - i * 16, size: 11, font })
    })
  }
  return pdf.save()
}

/** A blank multi-page PDF, for exercising the page-count boundary cap. */
export async function makeBlankPdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) pdf.addPage([612, 792])
  return pdf.save()
}
