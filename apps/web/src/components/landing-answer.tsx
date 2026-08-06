import { useState } from "react"
import { FileText, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The hero's centrepiece: a static, illustrative rendering of one grounded
 * answer. Hovering a [n] marker lights up the passage it came from — the whole
 * product in one gesture. Content is sample data, not a live session.
 */

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

/** Answer prose, split so each clause can fade in behind its own citation. */
const ANSWER: { text: string; cite: number }[] = [
  {
    text: "Enterprise pricing is locked to a $2,400 annual floor per workspace",
    cite: 1,
  },
  {
    text: ", with volume discounts capped at 20% on contracts above 50 seats",
    cite: 2,
  },
  {
    text: ". Anything below that floor needs pricing-committee sign-off before it reaches a quote",
    cite: 3,
  },
]

export function LandingAnswer() {
  const [active, setActive] = useState<number | null>(null)

  return (
    <div className="overflow-hidden rounded-2xl border border-black/8 bg-paper text-ink shadow-[0_40px_80px_-32px_oklch(0.17_0.014_264_/_0.55)]">
      {/* Session chrome */}
      <div className="flex items-center gap-2.5 border-b border-black/8 bg-paper-2/70 px-4 py-2.5 font-mono text-[10.5px] tracking-[0.08em] text-ink/55 uppercase">
        <span className="size-1.5 rounded-full bg-mark" />
        Q3 Pricing Review
        <span className="text-ink/25">/</span>
        <span className="normal-case">2 of 3 documents selected</span>
      </div>

      <div className="px-5 pt-5 pb-4 sm:px-6">
        {/* The question */}
        <div className="mb-5 flex justify-end">
          <p className="max-w-[85%] rounded-xl rounded-br-sm bg-ink px-3.5 py-2.5 text-[13.5px] leading-snug text-paper">
            What did we commit to on enterprise pricing?
          </p>
        </div>

        {/* The answer, with live citation markers */}
        <p className="text-[14.5px] leading-[1.75] text-ink/90">
          {ANSWER.map((clause, i) => (
            <span
              key={clause.cite}
              className="animate-in duration-700 fill-mode-both fade-in motion-reduce:animate-none"
              style={{ animationDelay: `${350 + i * 550}ms` }}
            >
              {clause.text}
              <CitationMarker
                n={clause.cite}
                active={active === clause.cite}
                delay={700 + i * 550}
                onActivate={setActive}
              />
            </span>
          ))}
          <span
            className="animate-in duration-700 fill-mode-both fade-in motion-reduce:animate-none"
            style={{ animationDelay: `${350 + ANSWER.length * 550}ms` }}
          >
            .
          </span>
        </p>

        {/* Sources panel */}
        <div className="mt-6 border-t border-dashed border-ink/15 pt-4">
          <p className="mb-2.5 font-mono text-[10.5px] tracking-[0.14em] text-ink/45 uppercase">
            Sources
          </p>
          <ul className="flex flex-col gap-1.5">
            {SOURCES.map((s) => (
              <li key={s.n}>
                <button
                  type="button"
                  id={`lp-source-${s.n}`}
                  onMouseEnter={() => setActive(s.n)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(s.n)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    "flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-200 outline-none",
                    active === s.n
                      ? "-translate-y-px border-mark/60 bg-mark/10 shadow-[0_6px_18px_-10px_oklch(0.55_0.14_72_/_0.8)]"
                      : "border-transparent bg-black/[0.025] hover:bg-black/[0.045]"
                  )}
                >
                  <span
                    className={cn(
                      "mt-px font-mono text-[11px] font-semibold transition-colors",
                      active === s.n ? "text-mark" : "text-ink/40"
                    )}
                  >
                    [{s.n}]
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                        <FileText className="size-3.5 shrink-0 text-ink/45" />
                        {s.doc}
                      </span>
                      <span className="font-mono text-[10.5px] text-ink/45">
                        p. {s.page} · chunk {s.chunk}
                      </span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-relaxed text-ink/60 italic">
                      “{s.snippet}”
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Provenance strip — recorded on every real answer, not derived */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/8 bg-paper-2/70 px-5 py-2.5 font-mono text-[10.5px] text-ink/50 sm:px-6">
        <Sparkles className="size-3 text-ink/35" />
        claude-3.7-sonnet
        <span className="text-ink/25">·</span>8 passages retrieved
        <span className="text-ink/25">·</span>3 cited
      </div>
    </div>
  )
}

function CitationMarker({
  n,
  active,
  delay,
  onActivate,
}: {
  n: number
  active: boolean
  delay: number
  onActivate: (n: number | null) => void
}) {
  return (
    <button
      type="button"
      aria-label={`Show source ${n}`}
      aria-controls={`lp-source-${n}`}
      onMouseEnter={() => onActivate(n)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(n)}
      onBlur={() => onActivate(null)}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "mx-0.5 inline-flex translate-y-[-1px] items-center rounded-[5px] px-1 py-px align-baseline font-mono text-[11px] font-semibold transition-colors duration-200 fill-mode-both outline-none zoom-in-50",
        "animate-in duration-300 fade-in motion-reduce:animate-none",
        active
          ? "bg-mark text-ink"
          : "bg-mark/18 text-[oklch(0.52_0.13_72)] hover:bg-mark/35"
      )}
    >
      [{n}]
    </button>
  )
}
