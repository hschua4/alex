/**
 * Typed mock data for the Alex UI shell.
 *
 * Shapes mirror the domain in CONTEXT.md (project / document / chat_session /
 * message / message_citation). This module is the single seam to replace with
 * the Hono RPC client (`hc<AppType>`) once the API exists — components only ever
 * read from the typed accessors below, never inline literals.
 */

export type DocType = "PDF" | "DOCX"
export type DocStatus = "indexed" | "processing" | "failed"

/** Decorative per-hue tint used for project icons and file-type badges. */
export type Tint = { bg: string; fg: string }

export type Project = {
  id: string
  name: string
  description: string
  docCount: number
  chatCount: number
  updatedLabel: string
  tint: Tint
}

export type Doc = {
  id: string
  name: string
  short: string
  type: DocType
  sizeLabel: string
  pages: number
  addedLabel: string
  status: DocStatus
}

export type Chat = {
  id: string
  title: string
  preview: string
  timeLabel: string
  docCount: number
}

export type Citation = {
  n: number
  docName: string
  locationLabel: string
  snippet: string
}

export type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; paragraphs: string[]; citations: Citation[] }

// ── decorative palettes ─────────────────────────────────────────────────────

const PROJECT_TINTS: Tint[] = [
  { bg: "oklch(0.94 0.05 264)", fg: "oklch(0.5 0.17 264)" },
  { bg: "oklch(0.94 0.05 160)", fg: "oklch(0.48 0.13 160)" },
  { bg: "oklch(0.94 0.05 25)", fg: "oklch(0.5 0.16 25)" },
  { bg: "oklch(0.94 0.05 300)", fg: "oklch(0.5 0.15 300)" },
  { bg: "oklch(0.94 0.05 65)", fg: "oklch(0.5 0.14 65)" },
  { bg: "oklch(0.94 0.05 200)", fg: "oklch(0.48 0.13 200)" },
]

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

// ── seed data ───────────────────────────────────────────────────────────────

export const projects: Project[] = [
  {
    id: "llm-eval",
    name: "LLM Evaluation Research",
    description: "Benchmarks, human eval rubrics, and faithfulness studies.",
    docCount: 8,
    chatCount: 5,
    updatedLabel: "2h ago",
    tint: PROJECT_TINTS[0],
  },
  {
    id: "q3-strategy",
    name: "Q3 Product Strategy",
    description: "Roadmap inputs, OKRs, and competitive positioning.",
    docCount: 12,
    chatCount: 9,
    updatedLabel: "Yesterday",
    tint: PROJECT_TINTS[1],
  },
  {
    id: "legal",
    name: "Legal & Compliance",
    description: "Contracts, DPAs, and regulatory guidance documents.",
    docCount: 23,
    chatCount: 4,
    updatedLabel: "3d ago",
    tint: PROJECT_TINTS[2],
  },
  {
    id: "interviews",
    name: "Customer Interviews",
    description: "Transcripts and synthesis from 40+ discovery calls.",
    docCount: 17,
    chatCount: 11,
    updatedLabel: "1w ago",
    tint: PROJECT_TINTS[3],
  },
  {
    id: "competitive",
    name: "Competitive Analysis",
    description: "Teardown notes and pricing sheets across 6 vendors.",
    docCount: 6,
    chatCount: 2,
    updatedLabel: "2w ago",
    tint: PROJECT_TINTS[4],
  },
  {
    id: "onboarding",
    name: "Onboarding Redesign",
    description: "Support tickets, session recordings, and UX audits.",
    docCount: 9,
    chatCount: 6,
    updatedLabel: "3w ago",
    tint: PROJECT_TINTS[5],
  },
]

export const documentsByProject: Record<string, Doc[]> = {
  "llm-eval": [
    { id: "d1", name: "Holistic Evaluation of Language Models.pdf", short: "Holistic Evaluation", type: "PDF", sizeLabel: "4.2 MB", pages: 112, addedLabel: "Jul 12", status: "indexed" },
    { id: "d2", name: "MMLU Benchmark — Methodology.docx", short: "MMLU Methodology", type: "DOCX", sizeLabel: "820 KB", pages: 24, addedLabel: "Jul 11", status: "indexed" },
    { id: "d3", name: "Chatbot Arena Elo Ratings Q2.pdf", short: "Chatbot Arena Elo", type: "PDF", sizeLabel: "2.1 MB", pages: 38, addedLabel: "Jul 10", status: "indexed" },
    { id: "d4", name: "Human Eval Rubric v3.docx", short: "Human Eval Rubric", type: "DOCX", sizeLabel: "540 KB", pages: 16, addedLabel: "Jul 09", status: "indexed" },
    { id: "d5", name: "RAG Faithfulness Study.pdf", short: "RAG Faithfulness", type: "PDF", sizeLabel: "3.8 MB", pages: 64, addedLabel: "Jul 08", status: "indexed" },
    { id: "d6", name: "Red-Teaming Findings Summary.docx", short: "Red-Teaming Findings", type: "DOCX", sizeLabel: "1.1 MB", pages: 42, addedLabel: "Jul 05", status: "indexed" },
    { id: "d7", name: "Cost & Latency Benchmarks.pdf", short: "Cost & Latency", type: "PDF", sizeLabel: "960 KB", pages: 18, addedLabel: "Jul 03", status: "processing" },
    { id: "d8", name: "Annotation Guidelines (draft).docx", short: "Annotation Guidelines", type: "DOCX", sizeLabel: "410 KB", pages: 12, addedLabel: "Jul 01", status: "indexed" },
  ],
}

export const chatsByProject: Record<string, Chat[]> = {
  "llm-eval": [
    { id: "c1", title: "Comparing eval benchmarks", preview: "How do MMLU and HELM differ in coverage?", timeLabel: "2h ago", docCount: 3 },
    { id: "c2", title: "Human eval inter-rater reliability", preview: "What agreement thresholds does the rubric set?", timeLabel: "Yesterday", docCount: 2 },
    { id: "c3", title: "RAG faithfulness metrics", preview: "Which metrics best detect hallucination?", timeLabel: "2d ago", docCount: 4 },
    { id: "c4", title: "Cost vs latency tradeoffs", preview: "Summarize the latency benchmarks by model.", timeLabel: "4d ago", docCount: 1 },
    { id: "c5", title: "Red-teaming coverage gaps", preview: "Where are the biggest safety gaps?", timeLabel: "1w ago", docCount: 3 },
  ],
}

export const messagesByChat: Record<string, Message[]> = {
  c1: [
    {
      id: "m1",
      role: "user",
      text: "How do MMLU and HELM differ in what they measure, and which is better for comparing instruction-tuned models?",
    },
    {
      id: "m2",
      role: "assistant",
      paragraphs: [
        "MMLU and HELM take fundamentally different approaches. MMLU is a single multiple-choice accuracy benchmark spanning 57 subjects, so it produces one headline score that is easy to compare but narrow — it only captures factual knowledge under a fixed answer format. [1]",
        "HELM instead evaluates models across seven distinct metrics (accuracy, calibration, robustness, fairness, bias, toxicity, and efficiency) over many scenarios, giving a multi-dimensional profile rather than a single number. [2]",
        "For instruction-tuned models, HELM is generally the stronger choice because it surfaces behavior beyond raw accuracy — but MMLU remains useful as a fast, widely-cited sanity check. [3]",
      ],
      citations: [
        { n: 1, docName: "MMLU Benchmark — Methodology.docx", locationLabel: "§2.1 · chunk 8", snippet: "MMLU comprises 57 subjects across STEM, humanities, and social sciences, scored as multiple-choice accuracy in a fixed zero-/few-shot format." },
        { n: 2, docName: "Holistic Evaluation of Language Models.pdf", locationLabel: "p. 14 · chunk 37", snippet: "HELM measures each model across seven metrics — accuracy, calibration, robustness, fairness, bias, toxicity, and efficiency — evaluated over a broad set of scenarios rather than a single task." },
        { n: 3, docName: "RAG Faithfulness Study.pdf", locationLabel: "p. 6 · chunk 12", snippet: "Single-score benchmarks can mask regressions in calibration and robustness that multi-metric suites like HELM are designed to expose." },
      ],
    },
  ],
}

// ── accessors (the seam a real API client would replace) ────────────────────

export function getProject(projectId: string): Project | undefined {
  return projects.find((p) => p.id === projectId)
}

export function getDocuments(projectId: string): Doc[] {
  return documentsByProject[projectId] ?? []
}

export function getChats(projectId: string): Chat[] {
  return chatsByProject[projectId] ?? []
}

export function getMessages(chatId: string): Message[] {
  return messagesByChat[chatId] ?? []
}

/** IDs of documents seeded as "in context" for the active chat. */
export const defaultSelectedDocIds = ["d1", "d2", "d4"]
