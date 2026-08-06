import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowRight, Check, Lock } from "lucide-react"
import { Link, Navigate } from "react-router-dom"

import { useSession } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { LandingAnswer } from "@/components/landing-answer"

/**
 * Public marketing page at "/" (the app itself lives under /app, behind the
 * RequireAuth guard). Signed-in visitors are bounced straight through, so the
 * root URL still "opens Alex" for anyone with a session.
 *
 * Aesthetic: an evidence dossier — ink on paper, ruled like a page, Fraunces
 * display over mono metadata. Every ochre [n] on this page is the same mark the
 * product puts on a claim; nothing else is allowed to use that colour.
 *
 * All figures below are drawn from CONTEXT.md. The hero answer is sample data.
 */
export function LandingScreen() {
  const { data: session } = useSession()

  // Don't gate the page on the session request: anonymous visitors (the whole
  // audience) would eat a spinner. Render immediately, redirect if it resolves.
  if (session) return <Navigate to="/app" replace />

  return (
    <div
      data-landing
      className="min-h-svh bg-paper font-sans text-ink selection:bg-mark/35"
    >
      <SiteNav />
      <Hero />
      <Ticker />
      <Principles />
      <HowItWorks />
      <CitationAnatomy />
      <SpecSheet />
      <ClosingCta />
      <SiteFooter />
    </div>
  )
}

/* ── Chrome ─────────────────────────────────────────────────────────────── */

function SiteNav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-300",
        scrolled
          ? "border-b border-white/10 bg-ink/85 backdrop-blur-md"
          : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex h-[70px] max-w-[1180px] items-center gap-8 px-6">
        <Wordmark />
        <nav className="hidden items-center gap-7 font-mono text-[11.5px] tracking-[0.1em] text-paper/55 uppercase md:flex">
          <a href="#how" className="transition-colors hover:text-paper">
            How it works
          </a>
          <a href="#citation" className="transition-colors hover:text-paper">
            Citations
          </a>
          <a href="#spec" className="transition-colors hover:text-paper">
            Under the hood
          </a>
        </nav>
        <div className="flex-1" />
        <Link
          to="/login"
          className="rounded-[10px] px-3.5 py-2 text-[13.5px] font-medium text-paper/70 transition-colors hover:text-paper"
        >
          Sign in
        </Link>
        <Link
          to="/login"
          className="group hidden items-center gap-1.5 rounded-[10px] bg-paper px-4 py-2 text-[13.5px] font-semibold text-ink transition-transform hover:-translate-y-px sm:inline-flex"
        >
          Use your invite
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </header>
  )
}

/**
 * The mark is the citation bracket itself — the one idea the product is built
 * on. (The in-app rail still shows the prototype's "R".)
 */
function Wordmark() {
  return (
    <span className="flex items-baseline gap-1.5 font-mono text-[15px] font-semibold tracking-tight text-paper">
      <span className="text-mark">[</span>
      alex
      <span className="text-mark">]</span>
    </span>
  )
}

/* ── Hero ───────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="lp-grain relative -mt-[70px] overflow-hidden bg-ink pt-[70px] text-paper">
      {/* Ruled sheet + a single indigo bloom behind the answer card */}
      <div className="lp-ruled absolute inset-0 text-white/70" aria-hidden />
      <div
        className="absolute -top-40 right-[-10%] size-[720px] rounded-full opacity-50 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, oklch(0.55 0.19 264 / 0.55), transparent 65%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto grid max-w-[1180px] gap-14 px-6 pt-16 pb-24 lg:grid-cols-12 lg:gap-10 lg:pt-24 lg:pb-32">
        <div className="lg:col-span-6 lg:pt-6">
          <p className="animate-in font-mono text-[11px] tracking-[0.22em] text-mark uppercase duration-700 fill-mode-both fade-in slide-in-from-bottom-3 motion-reduce:animate-none">
            Invite-only preview
          </p>

          <h1 className="lp-display mt-6 text-[clamp(2.9rem,6.6vw,5rem)] font-semibold text-paper">
            <span className="block animate-in delay-100 duration-700 fill-mode-both fade-in slide-in-from-bottom-4 motion-reduce:animate-none">
              Ask your
            </span>
            <span className="block animate-in delay-200 duration-700 fill-mode-both fade-in slide-in-from-bottom-4 motion-reduce:animate-none">
              documents.
            </span>
            <span className="block animate-in text-mark delay-300 duration-700 fill-mode-both fade-in slide-in-from-bottom-4 motion-reduce:animate-none">
              Check every claim.
              <a
                href="#note-1"
                id="ref-1"
                aria-label="Footnote one"
                className="ml-1 align-super font-mono text-[0.24em] font-semibold text-mark/70 transition-colors hover:text-mark"
              >
                [1]
              </a>
            </span>
          </h1>

          <p className="mt-7 max-w-[30rem] animate-in text-[16.5px] leading-relaxed text-paper/65 delay-500 duration-700 fill-mode-both fade-in motion-reduce:animate-none">
            Alex answers only from the documents you put in scope — never from
            what a model happens to remember. Every claim carries a numbered
            marker back to the page and passage it came from.
          </p>

          <div className="mt-9 flex animate-in flex-wrap items-center gap-3 delay-700 duration-700 fill-mode-both fade-in motion-reduce:animate-none">
            <Link
              to="/login"
              className="group inline-flex items-center gap-2 rounded-[10px] bg-mark px-5 py-3 text-[14.5px] font-semibold text-ink transition-transform hover:-translate-y-0.5"
            >
              <Lock className="size-4" />
              Sign in to Alex
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-[10px] border border-white/15 px-5 py-3 text-[14.5px] font-medium text-paper/80 transition-colors hover:border-white/35 hover:text-paper"
            >
              See how an answer is made
            </a>
          </div>

          <p className="mt-6 animate-in font-mono text-[11.5px] text-paper/40 delay-700 duration-1000 fill-mode-both fade-in motion-reduce:animate-none">
            Have an invite?{" "}
            <Link
              to="/login"
              className="text-paper/70 underline underline-offset-4 hover:text-paper"
            >
              Create your account
            </Link>
          </p>
        </div>

        <div className="animate-in delay-300 duration-1000 fill-mode-both fade-in slide-in-from-bottom-8 motion-reduce:animate-none lg:col-span-6">
          <div className="rotate-[0.6deg] transition-transform duration-500 hover:rotate-0">
            <LandingAnswer />
          </div>
          <p className="mt-4 text-center font-mono text-[10.5px] tracking-[0.12em] text-paper/35 uppercase">
            Sample answer · hover a marker
          </p>
        </div>
      </div>
    </section>
  )
}

/* ── Constraints ticker ─────────────────────────────────────────────────── */

const TICKER = [
  "PDF & DOCX",
  "≤ 20 MB per file",
  "~300 pages",
  "top-k 8 passages",
  "per-doc cap of 5",
  "page-level citations",
  "per-message document scope",
  "model picker",
  "provenance recorded",
]

function Ticker() {
  return (
    <div className="overflow-hidden border-y border-ink/10 bg-paper-2 py-3">
      <div className="flex w-max animate-ticker gap-0 motion-reduce:animate-none">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0" aria-hidden={copy === 1}>
            {TICKER.map((item) => (
              <span
                key={item}
                className="flex items-center gap-6 px-6 font-mono text-[11.5px] tracking-[0.06em] whitespace-nowrap text-ink/50"
              >
                {item}
                <span className="text-mark">◆</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Principles ─────────────────────────────────────────────────────────── */

const PRINCIPLES = [
  {
    kicker: "Scoped",
    title: "You choose what it can read.",
    body: "Documents are selected per message, not per conversation. Change the scope on any turn; send is blocked when nothing is selected. Retrieval never reaches past that set.",
  },
  {
    kicker: "Cited",
    title: "Markers are checked before you see them.",
    body: "Every [n] is validated against the passages actually retrieved. A marker that maps to nothing is dropped rather than shown — a citation you can click is a citation that exists.",
  },
  {
    kicker: "Recorded",
    title: "Each answer keeps its paperwork.",
    body: "The model that wrote it, the tokens it cost, the documents in scope, and the exact snippet behind each citation — snapshotted with the answer, so old threads still read true after a re-index.",
  },
]

function Principles() {
  return (
    <section className="mx-auto max-w-[1180px] px-6 py-24 lg:py-32">
      <Reveal>
        <p className="font-mono text-[11px] tracking-[0.22em] text-ink/40 uppercase">
          The premise
        </p>
        <h2 className="lp-display mt-5 max-w-[19ch] text-[clamp(2rem,4.2vw,3.4rem)] font-semibold">
          A chatbot guesses. Alex shows its work.
        </h2>
      </Reveal>

      <div className="mt-16 grid gap-px overflow-hidden rounded-2xl bg-ink/10 md:grid-cols-3">
        {PRINCIPLES.map((p, i) => (
          <Reveal key={p.kicker} delay={i * 120}>
            <div className="h-full bg-paper p-7 lg:p-9">
              <p className="font-mono text-[11px] tracking-[0.18em] text-mark uppercase">
                {p.kicker}
              </p>
              <h3 className="mt-4 text-[19px] leading-snug font-bold tracking-tight">
                {p.title}
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-ink/60">
                {p.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ── How it works ───────────────────────────────────────────────────────── */

const STEPS = [
  {
    n: "01",
    title: "Scope the question",
    body: "Pick the documents this turn should draw on and the model that should answer. The model list is enforced server-side.",
  },
  {
    n: "02",
    title: "Record the turn",
    body: "Your message and its document selection are saved before anything is retrieved, so a failed generation never loses the question.",
  },
  {
    n: "03",
    title: "Resolve the follow-up",
    body: "“What about its pricing?” is rewritten into a standalone query using recent turns, so retrieval sees a question that stands on its own.",
  },
  {
    n: "04",
    title: "Retrieve the passages",
    body: "Cosine search over indexed chunks, filtered to your selection, capped at five passages per document and trimmed to the best eight.",
  },
  {
    n: "05",
    title: "Answer from those passages",
    body: "The passages arrive pre-numbered. The model writes the answer against them and marks each claim with the number it came from.",
  },
  {
    n: "06",
    title: "Validate and store",
    body: "Markers are checked against what was actually retrieved, then the answer is saved with its citations, model, and token usage.",
  },
]

function HowItWorks() {
  return (
    <section
      id="how"
      className="scroll-mt-20 border-y border-ink/10 bg-paper-2"
    >
      <div className="mx-auto max-w-[1180px] px-6 py-24 lg:py-32">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ink/40 uppercase">
            Anatomy of an answer
          </p>
          <h2 className="lp-display mt-5 max-w-[16ch] text-[clamp(2rem,4.2vw,3.4rem)] font-semibold">
            Six steps, none of them guesswork.
          </h2>
        </Reveal>

        <ol className="mt-16 grid gap-x-14 gap-y-10 md:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step.n}>
              <Reveal delay={(i % 2) * 100}>
                <div className="border-t border-ink/15 pt-5">
                  <div className="flex items-baseline gap-4">
                    <span className="font-mono text-[12px] font-semibold text-mark">
                      {step.n}
                    </span>
                    <h3 className="text-[18px] font-bold tracking-tight">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-2.5 pl-[2.1rem] text-[14px] leading-relaxed text-ink/60">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ── Citation anatomy ───────────────────────────────────────────────────── */

const CITATION_PARTS = [
  { label: "Document", value: "Pricing_Strategy_Q3.pdf" },
  { label: "Page", value: "12" },
  { label: "Chunk", value: "4 of 118" },
  {
    label: "Snippet, as it read that day",
    value: "“…the enterprise floor holds at $2,400 per workspace per year…”",
  },
]

function CitationAnatomy() {
  return (
    <section
      id="citation"
      className="lp-grain relative scroll-mt-20 overflow-hidden bg-ink text-paper"
    >
      <div className="lp-ruled absolute inset-0 text-white/70" aria-hidden />

      <div className="relative mx-auto grid max-w-[1180px] gap-16 px-6 py-24 lg:grid-cols-2 lg:items-center lg:py-32">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.22em] text-mark uppercase">
            What [n] actually means
          </p>
          <h2 className="lp-display mt-5 text-[clamp(2rem,4.2vw,3.4rem)] font-semibold">
            One bracket, four facts.
          </h2>
          <p className="mt-6 max-w-[34rem] text-[15.5px] leading-relaxed text-paper/60">
            A marker isn’t a link to a document — it’s a pointer at the exact
            passage the sentence was written from, captured at the moment the
            answer was written. Re-index the file next month and the thread
            still reads exactly as it did.
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {[
              "Numbering is per answer — [1] here has nothing to do with [1] in the next reply.",
              "Unresolvable markers are stripped before the answer is stored.",
              "Only fully indexed documents are ever searched, so nothing is half-read.",
            ].map((line) => (
              <li key={line} className="flex gap-3 text-[14px] text-paper/70">
                <Check className="mt-0.5 size-4 shrink-0 text-mark" />
                {line}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={150}>
          <div className="relative rounded-2xl border border-white/12 bg-white/[0.03] p-7 backdrop-blur-sm lg:p-9">
            <div className="flex items-center gap-5">
              <span className="lp-display text-[clamp(3.5rem,7vw,5rem)] leading-none font-semibold text-mark">
                [3]
              </span>
              <span className="font-mono text-[11px] leading-relaxed tracking-[0.1em] text-paper/40 uppercase">
                resolves
                <br />
                to
              </span>
            </div>

            <dl className="mt-7 flex flex-col">
              {CITATION_PARTS.map((part) => (
                <div
                  key={part.label}
                  className="grid grid-cols-[7.5rem_1fr] gap-4 border-t border-white/10 py-3.5"
                >
                  <dt className="font-mono text-[10.5px] leading-relaxed tracking-[0.1em] text-paper/40 uppercase">
                    {part.label}
                  </dt>
                  <dd className="text-[13.5px] leading-relaxed text-paper/85">
                    {part.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ── Spec sheet ─────────────────────────────────────────────────────────── */

const SPEC: { label: string; value: ReactNode }[] = [
  {
    label: "Answer model",
    value:
      "Claude 3.7 Sonnet by default, switchable per message from a server-side allowlist.",
  },
  {
    label: "Follow-up handling",
    value:
      "GPT-4o-mini condenses a follow-up into a standalone query using the last few turns.",
  },
  {
    label: "Embeddings",
    value:
      "text-embedding-3-small, 1536 dimensions, HNSW index in Postgres via pgvector.",
  },
  {
    label: "Retrieval",
    value:
      "Cosine top-k 8, five-passage cap per document, similarity floor, indexed documents only.",
  },
  {
    label: "Ingestion",
    value:
      "Extract, chunk at ~600 tokens with overlap, batch-embed, index — in the background, with retries.",
  },
  {
    label: "Uploads",
    value: "PDF and DOCX, up to 20 MB and roughly 300 pages per file.",
  },
  {
    label: "Storage",
    value:
      "Originals in object storage; chunks, citations, and history in your own Postgres rows.",
  },
  {
    label: "Access",
    value:
      "Email and password sessions, scoped per user. Invite-only for the preview.",
  },
]

function SpecSheet() {
  return (
    <section id="spec" className="scroll-mt-20 border-t border-ink/10">
      <div className="mx-auto max-w-[1180px] px-6 py-24 lg:py-32">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ink/40 uppercase">
            Under the hood
          </p>
          <h2 className="lp-display mt-5 max-w-[18ch] text-[clamp(2rem,4.2vw,3.4rem)] font-semibold">
            The whole machine, on one page.
          </h2>
        </Reveal>

        <Reveal>
          <dl className="mt-14">
            {SPEC.map((row) => (
              <div
                key={row.label}
                className="group grid grid-cols-1 gap-1 border-t border-ink/12 py-5 transition-colors hover:bg-paper-2/60 sm:grid-cols-[13rem_1fr] sm:gap-8 sm:py-6"
              >
                <dt className="font-mono text-[11px] tracking-[0.12em] text-ink/45 uppercase transition-colors group-hover:text-mark">
                  {row.label}
                </dt>
                <dd className="max-w-[46rem] text-[15px] leading-relaxed text-ink/80">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  )
}

/* ── Closing ────────────────────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section className="lp-grain relative overflow-hidden bg-ink text-paper">
      <div
        className="absolute bottom-[-40%] left-1/2 size-[680px] -translate-x-1/2 rounded-full opacity-40 blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, oklch(0.79 0.14 72 / 0.35), transparent 65%)",
        }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-[1180px] px-6 py-28 text-center lg:py-36">
        <Reveal>
          <h2 className="lp-display mx-auto max-w-[16ch] text-[clamp(2.4rem,5.4vw,4.2rem)] font-semibold">
            Put your documents on the record.
          </h2>
          <p className="mx-auto mt-6 max-w-[34rem] text-[16px] leading-relaxed text-paper/60">
            Alex is in invite-only preview while the grounding is tuned. If you
            have an invite, your workspace is a click away.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="group inline-flex items-center gap-2 rounded-[10px] bg-mark px-6 py-3.5 text-[15px] font-semibold text-ink transition-transform hover:-translate-y-0.5"
            >
              Sign in
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-[10px] border border-white/15 px-6 py-3.5 text-[15px] font-medium text-paper/80 transition-colors hover:border-white/35 hover:text-paper"
            >
              Create an account
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className="bg-ink pb-12 text-paper">
      <div className="mx-auto max-w-[1180px] px-6">
        <div className="border-t border-white/10 pt-8">
          <p
            id="note-1"
            className="max-w-[52rem] scroll-mt-24 font-mono text-[11.5px] leading-relaxed text-paper/45"
          >
            <a
              href="#ref-1"
              className="text-mark transition-colors hover:text-mark/70"
            >
              [1]
            </a>{" "}
            Every claim in an Alex answer carries a numbered marker. Markers
            that don’t resolve to a retrieved passage are dropped before the
            answer is stored — so a citation you can open is a citation that
            exists.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Wordmark />
            <span className="font-mono text-[11.5px] text-paper/35">
              Grounded document chat · invite-only preview
            </span>
            <div className="flex-1" />
            <Link
              to="/login"
              className="font-mono text-[11.5px] text-paper/55 transition-colors hover:text-paper"
            >
              Sign in →
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

/* ── Scroll reveal ──────────────────────────────────────────────────────── */

/** Fades its child up the first time it enters the viewport. */
function Reveal({
  children,
  delay = 0,
}: {
  children: ReactNode
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setShown(true)
        observer.disconnect()
      },
      { rootMargin: "0px 0px -12% 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-shown={shown}
      style={{ transitionDelay: `${delay}ms` }}
      className="lp-reveal"
    >
      {children}
    </div>
  )
}
