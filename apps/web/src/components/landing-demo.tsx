import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react"
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Files,
  Loader2,
  MessagesSquare,
  Pause,
  Play,
  Search,
  Upload,
} from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The landing page's demo: a scripted walkthrough of the whole product, from
 * uploading a file to checking the passage behind a claim. It is a rendered
 * recreation rather than a screen capture — no video file, no stack to boot,
 * sharp at any size — but the layout, the numbers, and the flow are the real
 * app's (see routes/documents.tsx and routes/chat.tsx).
 *
 * Everything visible is a pure function of one clock: `derive(scene, local)`
 * maps elapsed time to a full UI state. Scrubbing to a chapter, pausing, and
 * the reduced-motion fallback are then all just different ways of choosing t.
 *
 * The sample data is deliberately the same session the hero card shows, so the
 * two read as one story: this is that answer being made.
 */

/* ── Script ─────────────────────────────────────────────────────────────── */

type DemoDoc = {
  id: string
  name: string
  kind: "pdf" | "docx"
  pages: number
  size: string
  chunks: number
}

/** `pricing` is the file uploaded on camera; the other two are already indexed. */
const DOCS: DemoDoc[] = [
  {
    id: "pricing",
    name: "Pricing_Strategy_Q3.pdf",
    kind: "pdf",
    pages: 42,
    size: "3.1 MB",
    chunks: 118,
  },
  {
    id: "board",
    name: "Board_Deck_Jul.pdf",
    kind: "pdf",
    pages: 28,
    size: "6.4 MB",
    chunks: 64,
  },
  {
    id: "contract",
    name: "Contract_Acme_v4.docx",
    kind: "docx",
    pages: 19,
    size: "840 KB",
    chunks: 51,
  },
]

const UPLOADED = DOCS[0]
const ALL_IDS = DOCS.map((d) => d.id)
/** The scope the question is actually asked with — the .docx is dropped. */
const SCOPED_IDS = ["pricing", "board"]
/** Chunks searched once the scope is two documents: 118 + 64. */
const SCANNED = DOCS.filter((d) => SCOPED_IDS.includes(d.id)).reduce(
  (n, d) => n + d.chunks,
  0
)

const QUESTION = "What did we commit to on enterprise pricing?"

type Token = { text: string } | { cite: number }

/** Same prose as the hero card, tokenised so it can stream in behind markers. */
const ANSWER: Token[] = [
  {
    text: "Enterprise pricing is locked to a $2,400 annual floor per workspace",
  },
  { cite: 1 },
  { text: ", with volume discounts capped at 20% on contracts above 50 seats" },
  { cite: 2 },
  {
    text: ". Anything below that floor needs pricing-committee sign-off before it reaches a quote",
  },
  { cite: 3 },
  { text: "." },
]

/** A marker occupies a few characters of the reveal so it lands on its own beat. */
const MARKER_LEN = 5

/**
 * Each token laid out on the reveal axis, once, at module load — so rendering a
 * frame of the stream is a pure read rather than a running cursor.
 */
const PLACED = ANSWER.reduce<{ token: Token; start: number; end: number }[]>(
  (acc, token) => {
    const start = acc.length === 0 ? 0 : acc[acc.length - 1].end
    const len = "cite" in token ? MARKER_LEN : token.text.length
    acc.push({ token, start, end: start + len })
    return acc
  },
  []
)

const ANSWER_LEN = PLACED[PLACED.length - 1].end

type Source = {
  n: number
  doc: string
  page: number
  chunk: number
  snippet: string
}

const SOURCES: Source[] = [
  {
    n: 1,
    doc: "Pricing_Strategy_Q3.pdf",
    page: 12,
    chunk: 4,
    snippet:
      "…the enterprise floor holds at $2,400 per workspace per year through FY26, with no regional exceptions.",
  },
  {
    n: 2,
    doc: "Pricing_Strategy_Q3.pdf",
    page: 14,
    chunk: 1,
    snippet:
      "Volume discounting is capped at 20% for any contract exceeding 50 seats; deeper cuts move to services.",
  },
  {
    n: 3,
    doc: "Board_Deck_Jul.pdf",
    page: 6,
    chunk: 2,
    snippet:
      "Exceptions below the floor require pricing-committee sign-off before a quote is issued.",
  },
]

/* ── Timeline ───────────────────────────────────────────────────────────── */

type SceneId = "upload" | "scope" | "ask" | "retrieve" | "answer" | "verify"

/** A pointer keyframe: be over `anchor` at `at` (0–1 of the scene). */
type PointerKey = { at: number; anchor: string; click?: boolean }

type Scene = {
  id: SceneId
  label: string
  caption: string
  duration: number
  pointer?: PointerKey[]
}

const SCENES: Scene[] = [
  {
    id: "upload",
    label: "Upload",
    caption:
      "A PDF goes in. It's extracted, chunked at ~600 tokens, embedded, and indexed in the background.",
    duration: 5000,
    pointer: [
      { at: 0.0, anchor: "upload" },
      { at: 0.07, anchor: "upload", click: true },
      { at: 0.3, anchor: "upload" },
    ],
  },
  {
    id: "scope",
    label: "Scope",
    caption:
      "Documents are chosen per message, not per conversation. Retrieval never reaches past this set.",
    duration: 3800,
    pointer: [
      { at: 0.1, anchor: "doc-contract" },
      { at: 0.5, anchor: "doc-contract" },
      { at: 0.56, anchor: "doc-contract", click: true },
      { at: 0.95, anchor: "doc-contract" },
    ],
  },
  {
    id: "ask",
    label: "Ask",
    caption:
      "The question and its document selection are recorded before anything is retrieved.",
    duration: 4200,
    pointer: [
      { at: 0.62, anchor: "composer" },
      { at: 0.78, anchor: "send" },
      { at: 0.84, anchor: "send", click: true },
      { at: 1, anchor: "send" },
    ],
  },
  {
    id: "retrieve",
    label: "Retrieve",
    caption:
      "Cosine search across the indexed chunks in scope — top eight passages, at most five from any one document.",
    duration: 3400,
  },
  {
    id: "answer",
    label: "Answer",
    caption:
      "The passages arrive pre-numbered. Each claim is written against one, and marked with its number.",
    duration: 7000,
  },
  {
    id: "verify",
    label: "Verify",
    caption:
      "Every marker resolves to a document, a page, and the snippet as it read that day. Unresolvable ones never ship.",
    duration: 5200,
    pointer: [
      { at: 0.12, anchor: "cite-2" },
      { at: 0.42, anchor: "cite-2" },
      { at: 0.58, anchor: "cite-3" },
      { at: 0.86, anchor: "cite-3" },
    ],
  },
]

const TOTAL = SCENES.reduce((n, s) => n + s.duration, 0)
/** Absolute start time of each scene, by index. */
const STARTS = SCENES.reduce<number[]>((acc, _s, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + SCENES[i - 1].duration)
  return acc
}, [])
/** The frame shown when motion is suppressed: a settled, fully cited answer. */
const POSTER =
  STARTS[SCENES.length - 1] + SCENES[SCENES.length - 1].duration * 0.35

function sceneAt(t: number) {
  let i = 0
  while (i < SCENES.length - 1 && t >= STARTS[i + 1]) i++
  return i
}

/* ── Derived state ──────────────────────────────────────────────────────── */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Local progress of a sub-beat running from `a` to `b` within a scene. */
const span = (v: number, a: number, b: number) => clamp01((v - a) / (b - a))
const ease = (v: number) =>
  v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2

type IngestStage =
  "queued" | "uploading" | "extracting" | "chunking" | "embedding" | "indexed"

const STAGE_LABEL: Record<IngestStage, string> = {
  queued: "Queued",
  uploading: "Uploading",
  extracting: "Extracting text",
  chunking: "Chunking ~600 tokens",
  embedding: "Embedding",
  indexed: "Indexed",
}

type DemoState = {
  view: "documents" | "chat"
  ingest: {
    visible: boolean
    progress: number
    stage: IngestStage
    chunks: number
  }
  selected: string[]
  typed: string
  typing: boolean
  phase: "idle" | "searching" | "streaming" | "done"
  reveal: number
  retrieval: { show: boolean; scanned: number; kept: number }
  panel: "documents" | "sources"
  activeCite: number | null
  provenance: boolean
}

/** The single source of truth: elapsed time in, a whole frame of UI out. */
function derive(scene: SceneId, p: number): DemoState {
  const base: DemoState = {
    view: "chat",
    ingest: {
      visible: true,
      progress: 1,
      stage: "indexed",
      chunks: UPLOADED.chunks,
    },
    selected: SCOPED_IDS,
    typed: "",
    typing: false,
    phase: "idle",
    reveal: 0,
    retrieval: { show: false, scanned: 0, kept: 0 },
    panel: "documents",
    activeCite: null,
    provenance: false,
  }

  switch (scene) {
    case "upload": {
      const stage: IngestStage =
        p < 0.1
          ? "queued"
          : p < 0.3
            ? "uploading"
            : p < 0.44
              ? "extracting"
              : p < 0.6
                ? "chunking"
                : p < 0.84
                  ? "embedding"
                  : "indexed"
      return {
        ...base,
        view: "documents",
        selected: ALL_IDS,
        ingest: {
          visible: p > 0.08,
          // Upload bar fills first; the rest of the bar tracks the ingest run.
          progress:
            stage === "uploading" ? span(p, 0.1, 0.3) : span(p, 0.3, 0.84),
          stage,
          chunks: Math.round(span(p, 0.44, 0.84) * UPLOADED.chunks),
        },
      }
    }

    case "scope":
      return { ...base, selected: p < 0.56 ? ALL_IDS : SCOPED_IDS }

    case "ask": {
      const typedTo = Math.round(span(p, 0.06, 0.62) * QUESTION.length)
      return {
        ...base,
        typed: p < 0.86 ? QUESTION.slice(0, typedTo) : "",
        typing: p < 0.7,
        phase: p < 0.86 ? "idle" : "searching",
      }
    }

    case "retrieve":
      return {
        ...base,
        phase: "searching",
        retrieval: {
          show: true,
          scanned: Math.round(span(p, 0.04, 0.62) * SCANNED),
          kept: Math.round(span(p, 0.56, 0.92) * 8),
        },
      }

    case "answer": {
      const reveal = Math.round(span(p, 0.06, 0.8) * ANSWER_LEN)
      return {
        ...base,
        phase: p < 0.86 ? "streaming" : "done",
        reveal,
        retrieval: { show: false, scanned: SCANNED, kept: 8 },
        panel: p < 0.34 ? "documents" : "sources",
        provenance: p > 0.88,
      }
    }

    case "verify":
      return {
        ...base,
        phase: "done",
        reveal: ANSWER_LEN,
        retrieval: { show: false, scanned: SCANNED, kept: 8 },
        panel: "sources",
        provenance: true,
        activeCite:
          p < 0.14 ? null : p < 0.5 ? 2 : p < 0.56 ? null : p < 0.9 ? 3 : null,
      }
  }
}

/* ── Player ─────────────────────────────────────────────────────────────── */

export function LandingDemo() {
  const reduced = usePrefersReducedMotion()
  const [t, setT] = useState(0)
  const [paused, setPaused] = useState(false)
  const [inView, setInView] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)

  const playing = inView && !paused && !reduced

  // Reduced motion gets a settled poster frame instead of a running clock —
  // derived, not assigned, so a chapter jump (which moves t off zero) wins.
  const clock = reduced && t === 0 ? POSTER : t

  // Only run while on screen — an off-screen rAF loop is pure waste.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "0px 0px -10% 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ~30fps is plenty for fades and typing, and a third of the renders of 60.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      acc += now - last
      last = now
      if (acc >= 33) {
        const step = acc
        acc = 0
        setT((prev) => (prev + step) % TOTAL)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const index = sceneAt(clock)
  const scene = SCENES[index]
  const local = clamp01((clock - STARTS[index]) / scene.duration)
  const state = derive(scene.id, local)

  usePointer(frameRef, cursorRef, scene, local, reduced)

  /** Reduced motion has no run-up, so a chapter jump lands on its settled frame. */
  const jumpTo = (i: number) =>
    setT(STARTS[i] + (reduced ? SCENES[i].duration * 0.9 : 0))

  return (
    <div ref={rootRef}>
      {/*
        The frame animates too fast to be narrated usefully; the chapter list
        and caption below carry the same content as static text.
      */}
      <div
        ref={frameRef}
        aria-hidden
        className="relative overflow-hidden rounded-[18px] border border-white/12 bg-paper shadow-[0_50px_100px_-40px_oklch(0.1_0.02_264_/_0.9)]"
      >
        <TitleBar scene={scene} />
        <div className="relative h-[430px] sm:h-[490px] lg:h-[520px]">
          {state.view === "documents" ? (
            <DocumentsStage state={state} />
          ) : (
            <ChatStage state={state} />
          )}
          <Cursor ref={cursorRef} />
        </div>
      </div>

      <Transport
        index={index}
        local={local}
        elapsed={clock}
        playing={playing}
        reduced={reduced}
        onToggle={() => setPaused((v) => !v)}
        onJump={jumpTo}
      />

      <p className="mt-5 min-h-[3.25rem] max-w-[62ch] text-[14.5px] leading-relaxed text-paper/65">
        <span className="font-mono text-[11px] tracking-[0.16em] text-paper/40 uppercase">
          {String(index + 1).padStart(2, "0")} ·{" "}
        </span>
        {scene.caption}
      </p>
    </div>
  )
}

function TitleBar({ scene }: { scene: Scene }) {
  return (
    <div className="flex items-center gap-3 border-b border-black/8 bg-paper-2/80 px-4 py-2.5">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-[9px] rounded-full bg-ink/15" />
        ))}
      </div>
      <div className="flex-1 text-center font-mono text-[10.5px] tracking-[0.08em] text-ink/45">
        alex — Q3 Pricing Review
      </div>
      <div className="hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-ink/40 uppercase sm:flex">
        <span className="size-1.5 rounded-full bg-lp-accent" />
        {scene.label}
      </div>
    </div>
  )
}

/* ── Stage: documents view ──────────────────────────────────────────────── */

function DocumentsStage({ state }: { state: DemoState }) {
  const { ingest } = state
  const done = ingest.stage === "indexed"

  return (
    <div className="flex h-full">
      <Rail active="documents" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center border-b border-ink/8 px-5">
          <h3 className="text-[14.5px] font-bold tracking-tight text-ink">
            Documents
          </h3>
          <div className="flex-1" />
          <span
            data-demo-anchor="upload"
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] bg-lp-accent px-3 text-[12px] font-semibold text-white"
          >
            <Upload className="size-3.5" strokeWidth={2.2} />
            Upload
          </span>
        </div>

        <div className="flex-1 overflow-hidden px-5 py-4">
          <div className="mb-4 flex items-center gap-3.5 rounded-[12px] border-2 border-dashed border-ink/15 px-4 py-3.5">
            <div className="flex size-9 items-center justify-center rounded-[10px] bg-lp-accent/10 text-lp-accent">
              <Upload className="size-[17px]" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-ink">
                Drop files here or click to upload
              </p>
              <p className="mt-0.5 text-[11px] text-ink/50">
                PDF and Word (.docx) up to 20 MB each · chunked and indexed
                automatically
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-[12px] border border-ink/10">
            {ingest.visible && (
              <IngestingRow
                doc={UPLOADED}
                stage={ingest.stage}
                progress={ingest.progress}
                chunks={ingest.chunks}
              />
            )}
            {DOCS.slice(1).map((doc) => (
              <DocRow key={doc.id} doc={doc} />
            ))}
          </div>

          <p
            className={cn(
              "mt-3.5 flex items-center gap-2 font-mono text-[11px] text-ink/45 transition-opacity duration-500",
              done ? "opacity-100" : "opacity-0"
            )}
          >
            <Check className="size-3.5 text-lp-ok" strokeWidth={2.6} />
            {UPLOADED.chunks} chunks embedded · 1536 dimensions · searchable
          </p>
        </div>
      </div>
    </div>
  )
}

function IngestingRow({
  doc,
  stage,
  progress,
  chunks,
}: {
  doc: DemoDoc
  stage: IngestStage
  progress: number
  chunks: number
}) {
  const done = stage === "indexed"
  return (
    <div className="animate-in border-b border-ink/8 bg-lp-accent/[0.04] px-4 py-3 duration-500 fade-in slide-in-from-top-2">
      <div className="flex items-center gap-3">
        <Badge kind={doc.kind} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-ink">
            {doc.name}
          </p>
          <p className="mt-px font-mono text-[10.5px] text-ink/45">
            {doc.pages} pages · {doc.size}
            {stage === "embedding" || done ? ` · ${chunks} chunks` : ""}
          </p>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 text-[11.5px] font-medium",
            done ? "text-lp-ok" : "text-lp-accent"
          )}
        >
          {done ? (
            <span className="size-[7px] rounded-full bg-lp-ok" />
          ) : (
            <Loader2 className="size-3 animate-spin" />
          )}
          {STAGE_LABEL[stage]}
        </span>
      </div>
      <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-ink/8">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-100 ease-linear",
            done ? "bg-lp-ok" : "bg-lp-accent"
          )}
          style={{ width: `${(done ? 1 : progress) * 100}%` }}
        />
      </div>
    </div>
  )
}

function DocRow({ doc }: { doc: DemoDoc }) {
  return (
    <div className="flex items-center gap-3 border-b border-ink/8 px-4 py-3 last:border-b-0">
      <Badge kind={doc.kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-ink">
          {doc.name}
        </p>
        <p className="mt-px font-mono text-[10.5px] text-ink/45">
          {doc.pages} pages · {doc.size} · {doc.chunks} chunks
        </p>
      </div>
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-lp-ok">
        <span className="size-[7px] rounded-full bg-lp-ok" />
        Indexed
      </span>
    </div>
  )
}

/* ── Stage: chat view ───────────────────────────────────────────────────── */

function ChatStage({ state }: { state: DemoState }) {
  const count = state.selected.length

  return (
    <div className="flex h-full">
      <Rail active="chat" />

      <div className="flex min-w-0 flex-1 flex-col bg-paper-2/40">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-ink/8 bg-paper px-5">
          <h3 className="truncate text-[14.5px] font-bold tracking-tight text-ink">
            Enterprise pricing commitments
          </h3>
          <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-lp-accent/10 px-2.5 text-[11.5px] font-semibold text-lp-accent">
            <FileText className="size-3" strokeWidth={2.3} />
            {count} {count === 1 ? "document" : "documents"} in context
          </span>
        </div>

        <div className="flex-1 overflow-hidden px-5 py-5">
          {/* Centred so a one-turn thread doesn't leave a hole above the composer. */}
          <div className="mx-auto flex h-full max-w-[440px] flex-col justify-center gap-4">
            <Transcript state={state} />
          </div>
        </div>

        <Composer state={state} />
      </div>

      <SidePanel state={state} />
    </div>
  )
}

function Transcript({ state }: { state: DemoState }) {
  if (state.phase === "idle" && state.reveal === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex size-10 items-center justify-center rounded-[12px] bg-lp-accent/10 text-lp-accent">
          <FileText className="size-5" strokeWidth={2} />
        </div>
        <p className="mt-3 text-[13px] font-semibold text-ink">
          Ask a question about your documents
        </p>
        <p className="mt-1 max-w-[300px] text-[11.5px] leading-relaxed text-ink/50">
          Select the documents to search, then ask below. Answers come with
          numbered citations back to the source.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[14px] rounded-br-[4px] bg-lp-accent px-3.5 py-2.5 text-[12.5px] leading-snug text-white">
          {QUESTION}
        </p>
      </div>

      {state.retrieval.show ? (
        <RetrievalReadout retrieval={state.retrieval} />
      ) : state.phase === "searching" ? (
        <div className="flex items-center gap-2 text-ink/50">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="text-[12px]">Searching your documents…</span>
        </div>
      ) : (
        <AnswerBody state={state} />
      )}
    </div>
  )
}

/** The retrieval step, shown as it happens: what was searched, what survived. */
function RetrievalReadout({
  retrieval,
}: {
  retrieval: DemoState["retrieval"]
}) {
  return (
    <div className="animate-in rounded-[12px] border border-ink/10 bg-paper p-3.5 duration-500 fade-in">
      <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.12em] text-ink/45 uppercase">
        <Search className="size-3" strokeWidth={2.4} />
        Cosine search · 2 documents
      </p>

      {/* One tick per chunk searched; the eight that survive light up. */}
      <div className="mt-3 flex flex-wrap gap-[3px]">
        {Array.from({ length: 60 }).map((_, i) => {
          const reached = i / 60 < retrieval.scanned / SCANNED
          const kept = reached && i % 7 === 3 && (i - 3) / 7 < retrieval.kept
          return (
            <span
              key={i}
              className={cn(
                "h-3.5 w-[3px] rounded-full transition-colors duration-200",
                kept ? "bg-lp-accent" : reached ? "bg-ink/20" : "bg-ink/[0.07]"
              )}
            />
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink/50">
        <span>{retrieval.scanned} chunks scanned</span>
        <span className="text-ink/25">·</span>
        <span className="font-semibold text-lp-accent">
          top {retrieval.kept} kept
        </span>
        <span className="text-ink/25">·</span>
        <span>max 5 per document</span>
      </div>
    </div>
  )
}

function AnswerBody({ state }: { state: DemoState }) {
  const streaming = state.phase === "streaming"

  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-ink text-[11px] font-extrabold text-paper">
        A
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-[1.8] text-ink/90">
          {PLACED.map(({ token, start, end }, i) => {
            if ("cite" in token) {
              return state.reveal >= end ? (
                <Marker
                  key={i}
                  n={token.cite}
                  active={state.activeCite === token.cite}
                />
              ) : null
            }
            return (
              <span key={i}>
                {token.text.slice(0, Math.max(0, state.reveal - start))}
              </span>
            )
          })}
          {streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-lp-accent align-middle" />
          )}
        </p>

        {state.provenance && (
          <p className="mt-3.5 flex animate-in flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-dashed border-ink/15 pt-3 font-mono text-[10px] text-ink/45 duration-700 fade-in">
            claude-3.7-sonnet
            <span className="text-ink/25">·</span>8 passages retrieved
            <span className="text-ink/25">·</span>3 cited
            <span className="text-ink/25">·</span>1,842 tokens
          </p>
        )}
      </div>
    </div>
  )
}

/** The one place ochre is allowed: a citation numeral. */
function Marker({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      data-demo-anchor={`cite-${n}`}
      className={cn(
        // Left margin only: a marker follows a word but is often followed by
        // punctuation, which should sit tight against it.
        "ml-0.5 inline-flex translate-y-[-1px] animate-in items-center rounded-[5px] px-1 py-px align-baseline font-mono text-[10px] font-semibold duration-300 zoom-in-50 fade-in",
        active ? "bg-mark text-ink" : "bg-mark/20 text-[oklch(0.52_0.13_72)]"
      )}
    >
      [{n}]
    </span>
  )
}

function Composer({ state }: { state: DemoState }) {
  const docs = DOCS.filter((d) => state.selected.includes(d.id))
  const armed = state.typed.trim().length > 0

  return (
    <div className="shrink-0 px-5 pb-4">
      <div className="mx-auto max-w-[440px]">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] font-medium text-ink/45">
            Chatting with
          </span>
          {docs.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex h-[22px] animate-in items-center gap-1.5 rounded-[6px] border border-ink/12 bg-paper px-1.5 text-[10.5px] font-medium text-ink/75 duration-300 fade-in"
            >
              <Badge kind={doc.kind} size="sm" />
              {doc.name.replace(/\.(pdf|docx)$/i, "")}
            </span>
          ))}
        </div>

        <div
          data-demo-anchor="composer"
          className="rounded-[14px] border border-ink/12 bg-paper p-3 shadow-[0_4px_16px_-8px_oklch(0.4_0.03_264_/_0.25)]"
        >
          <p className="min-h-[18px] text-[12.5px] leading-snug text-ink">
            {state.typed || (
              <span className="text-ink/35">
                Ask a question about your selected documents…
              </span>
            )}
            {state.typing && (
              <span className="ml-px inline-block h-3.5 w-[1.5px] translate-y-0.5 animate-pulse bg-ink align-middle" />
            )}
          </p>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="inline-flex h-[26px] items-center gap-1 rounded-[8px] border border-ink/12 px-2 text-[11px] text-ink/55">
              Claude 3.7 Sonnet
              <ChevronDown className="size-3 opacity-60" />
            </span>
            <span
              data-demo-anchor="send"
              className={cn(
                "flex size-7 items-center justify-center rounded-[9px] transition-colors duration-300",
                armed ? "bg-lp-accent text-white" : "bg-ink/10 text-ink/30"
              )}
            >
              <ArrowUp className="size-3.5" strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidePanel({ state }: { state: DemoState }) {
  return (
    <aside className="hidden w-[228px] shrink-0 flex-col border-l border-ink/8 bg-paper lg:flex">
      <div className="flex gap-1 border-b border-ink/8 px-3 pt-3">
        {(["documents", "sources"] as const).map((tab) => (
          <span
            key={tab}
            className={cn(
              "border-b-2 px-2 pb-2.5 text-[11.5px] font-semibold capitalize transition-colors",
              state.panel === tab
                ? "border-lp-accent text-ink"
                : "border-transparent text-ink/45"
            )}
          >
            {tab}
          </span>
        ))}
      </div>

      {state.panel === "documents" ? (
        <div className="flex flex-col gap-0.5 p-2">
          {DOCS.map((doc) => {
            const on = state.selected.includes(doc.id)
            return (
              <div
                key={doc.id}
                data-demo-anchor={`doc-${doc.id}`}
                className="flex items-center gap-2.5 rounded-[9px] p-2"
              >
                <span
                  className={cn(
                    "flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-200",
                    on
                      ? "border-lp-accent bg-lp-accent text-white"
                      : "border-ink/25 bg-transparent"
                  )}
                >
                  {on && <Check className="size-2.5" strokeWidth={3.5} />}
                </span>
                <Badge kind={doc.kind} size="sm" />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-[11px] font-semibold transition-colors",
                      on ? "text-ink" : "text-ink/50"
                    )}
                  >
                    {doc.name}
                  </p>
                  <p className="font-mono text-[9.5px] text-ink/40">
                    {doc.pages} pages
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-hidden p-3">
          {SOURCES.map((source) => {
            const shown = state.reveal >= markerEnd(source.n)
            if (!shown) return null
            const active = state.activeCite === source.n
            return (
              <div
                key={source.n}
                className={cn(
                  "animate-in overflow-hidden rounded-[10px] border transition-all duration-300 fade-in slide-in-from-right-2",
                  active
                    ? "-translate-y-px border-mark/70 bg-mark/10 shadow-[0_8px_20px_-12px_oklch(0.55_0.14_72_/_0.9)]"
                    : "border-ink/10 bg-paper"
                )}
              >
                <div className="flex items-center gap-2 border-b border-ink/8 px-2.5 py-2">
                  <span
                    className={cn(
                      "flex size-[17px] shrink-0 items-center justify-center rounded-[5px] font-mono text-[10px] font-bold transition-colors",
                      active
                        ? "bg-mark text-ink"
                        : "bg-mark/20 text-[oklch(0.52_0.13_72)]"
                    )}
                  >
                    {source.n}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[10.5px] font-semibold text-ink">
                      {source.doc}
                    </p>
                    <p className="font-mono text-[9.5px] text-ink/45">
                      p. {source.page} · chunk {source.chunk}
                    </p>
                  </div>
                </div>
                <p className="px-2.5 py-2 text-[10.5px] leading-relaxed text-ink/60 italic">
                  “{source.snippet}”
                </p>
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}

/** Reveal offset at which marker `n` has finished streaming in. */
function markerEnd(n: number) {
  const placed = PLACED.find(({ token }) => "cite" in token && token.cite === n)
  return placed ? placed.end : Infinity
}

/* ── Shared chrome ──────────────────────────────────────────────────────── */

function Rail({ active }: { active: "documents" | "chat" }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1.5 bg-ink py-3">
      {(
        [
          { id: "chat", Icon: MessagesSquare },
          { id: "documents", Icon: Files },
        ] as const
      ).map(({ id, Icon }) => (
        <span
          key={id}
          className={cn(
            "flex size-7 items-center justify-center rounded-[8px] transition-colors",
            active === id ? "bg-white/15 text-paper" : "text-paper/35"
          )}
        >
          <Icon className="size-[15px]" strokeWidth={2} />
        </span>
      ))}
    </div>
  )
}

function Badge({
  kind,
  size = "md",
}: {
  kind: "pdf" | "docx"
  size?: "sm" | "md"
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[5px] font-mono font-bold tracking-tight text-white",
        kind === "pdf"
          ? "bg-[oklch(0.55_0.17_25)]"
          : "bg-[oklch(0.5_0.13_250)]",
        size === "sm" ? "h-3.5 w-6 text-[7px]" : "h-7 w-7 text-[8px]"
      )}
    >
      {kind === "pdf" ? "PDF" : "DOC"}
    </span>
  )
}

/* ── Cursor ─────────────────────────────────────────────────────────────── */

const Cursor = ({ ref }: { ref: RefObject<HTMLDivElement | null> }) => (
  <div
    ref={ref}
    className="group/cursor pointer-events-none absolute top-0 left-0 z-20 hidden opacity-0 transition-opacity duration-300 lg:block"
    style={{ willChange: "transform" }}
  >
    <span className="absolute -top-2 -left-2 block size-9 scale-0 rounded-full bg-lp-accent/25 opacity-0 transition-all duration-300 group-data-[click=true]/cursor:scale-100 group-data-[click=true]/cursor:opacity-100" />
    <svg
      viewBox="0 0 12 18"
      className="relative size-[18px] drop-shadow-[0_2px_4px_oklch(0.2_0.02_264_/_0.45)]"
      fill="none"
    >
      <path
        d="M1 1.2 10.6 10.2 6.1 10.6 3.9 15.4Z"
        className="fill-paper stroke-ink"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  </div>
)

/**
 * Positions the cursor by measuring its target elements each frame rather than
 * hard-coding coordinates — the layout is responsive, so measured anchors are
 * the only thing that stays aligned. Writes straight to the node to keep the
 * clock's re-render count at one per frame.
 */
function usePointer(
  frameRef: RefObject<HTMLDivElement | null>,
  cursorRef: RefObject<HTMLDivElement | null>,
  scene: Scene,
  local: number,
  reduced: boolean
) {
  useLayoutEffect(() => {
    const cursor = cursorRef.current
    const frame = frameRef.current
    if (!cursor || !frame) return

    const keys = scene.pointer
    const hide = () => {
      cursor.style.opacity = "0"
      cursor.dataset.click = "false"
    }
    if (!keys?.length || reduced) return hide()

    const last = keys[keys.length - 1]
    if (local < keys[0].at - 0.08 || local > last.at + 0.08) return hide()

    let i = 0
    while (i < keys.length - 1 && keys[i + 1].at <= local) i++
    const a = keys[i]
    const b = keys[Math.min(i + 1, keys.length - 1)]
    const width = b.at - a.at
    const f = width > 0 ? ease(clamp01((local - a.at) / width)) : 1

    // Measure against the cursor's own containing block (the stage), not the
    // frame — the frame includes the title bar, which would offset every point.
    const base = cursor.offsetParent
    if (!(base instanceof HTMLElement)) return hide()

    const from = anchorCenter(frame, base, a.anchor)
    const to = anchorCenter(frame, base, b.anchor)
    if (!from || !to) return hide()

    cursor.style.opacity = "1"
    cursor.style.transform = `translate3d(${from.x + (to.x - from.x) * f}px, ${
      from.y + (to.y - from.y) * f
    }px, 0)`

    const clicking = keys.some((k) => k.click && Math.abs(local - k.at) < 0.045)
    cursor.dataset.click = clicking ? "true" : "false"
  }, [frameRef, cursorRef, scene, local, reduced])
}

/** Centre of an anchored element, in `base`'s coordinate space. */
function anchorCenter(frame: HTMLElement, base: HTMLElement, anchor: string) {
  const el = frame.querySelector<HTMLElement>(`[data-demo-anchor="${anchor}"]`)
  if (!el) return null
  const a = el.getBoundingClientRect()
  const b = base.getBoundingClientRect()
  return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 }
}

/* ── Transport ──────────────────────────────────────────────────────────── */

function Transport({
  index,
  local,
  elapsed,
  playing,
  reduced,
  onToggle,
  onJump,
}: {
  index: number
  local: number
  elapsed: number
  playing: boolean
  reduced: boolean
  onToggle: () => void
  onJump: (i: number) => void
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-3">
      {!reduced && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? "Pause the demo" : "Play the demo"}
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/15 text-paper/70 transition-colors hover:border-white/40 hover:text-paper"
        >
          {playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 translate-x-px fill-current" />
          )}
        </button>
      )}

      <ol className="flex min-w-0 flex-1 flex-wrap gap-x-1 gap-y-2">
        {SCENES.map((scene, i) => (
          <li key={scene.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onJump(i)}
              aria-current={i === index ? "step" : undefined}
              className="group/chapter block px-1.5 pb-1.5 text-left"
            >
              <span
                className={cn(
                  "font-mono text-[10.5px] tracking-[0.12em] uppercase transition-colors",
                  i === index
                    ? "text-paper"
                    : "text-paper/35 group-hover/chapter:text-paper/70"
                )}
              >
                {String(i + 1).padStart(2, "0")} {scene.label}
              </span>
              <span className="mt-1.5 block h-[2px] w-full overflow-hidden rounded-full bg-white/12">
                <span
                  className="block h-full rounded-full bg-mark"
                  style={{
                    width:
                      i < index
                        ? "100%"
                        : i === index
                          ? `${local * 100}%`
                          : "0%",
                  }}
                />
              </span>
            </button>
          </li>
        ))}
      </ol>

      <span className="shrink-0 font-mono text-[10.5px] text-paper/35 tabular-nums">
        {formatTime(elapsed)} / {formatTime(TOTAL)}
      </span>
    </div>
  )
}

function formatTime(ms: number) {
  const total = Math.floor(ms / 1000)
  return `0:${String(total % 60).padStart(2, "0")}`
}

/* ── Reduced motion ─────────────────────────────────────────────────────── */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false
  )
}
