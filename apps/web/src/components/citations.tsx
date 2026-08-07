import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { FileText } from "lucide-react"

import type { Citation } from "@/lib/chat"
import { cn } from "@/lib/utils"

/**
 * Citation highlighting. The `[n]` markers in an answer and every list of the
 * passages behind it are views of one thing, so lighting one lights the others —
 * the gesture the landing hero demonstrates.
 *
 * Two contexts, deliberately:
 *  - `HighlightCtx` owns which citation is lit. It sits *above* the whole chat
 *    layout so a marker in the transcript can light the matching row in the
 *    right-hand panel, and holds its own state so hovering re-renders only the
 *    markers and rows — `children` is a stable prop, and context updates reach
 *    consumers through the memoised markdown without re-parsing it.
 *  - `ScopeCtx` names the answer a marker or row belongs to, so `[1]` under one
 *    answer never lights `[1]` under another.
 *
 * Ochre (`--citation`) is reserved for these numerals and the rows they open,
 * matching `--mark` on the landing surface.
 */

type Active = { scope: string; n: number } | null

const HighlightCtx = createContext<{
  active: Active
  setActive: (next: Active) => void
  select: (scope: string, n: number) => void
} | null>(null)

const ScopeCtx = createContext<string | null>(null)

export function CitationHighlightProvider({
  onSelect,
  children,
}: {
  /**
   * Clicking a marker asks for its passage. The sources live in the side panel,
   * which the host has to reveal — and point at the answer that was clicked,
   * which may not be the latest one.
   */
  onSelect: (scope: string, n: number) => void
  children: ReactNode
}) {
  const [active, setActive] = useState<Active>(null)
  const value = useMemo(
    () => ({ active, setActive, select: onSelect }),
    [active, onSelect]
  )
  return <HighlightCtx.Provider value={value}>{children}</HighlightCtx.Provider>
}

/** Names the answer that the markers and source rows inside belong to. */
export function CitationScope({
  id,
  children,
}: {
  id: string
  children: ReactNode
}) {
  return <ScopeCtx.Provider value={id}>{children}</ScopeCtx.Provider>
}

const rowId = (scope: string, n: number) => `cite-${scope}-${n}`

/** Read/write the highlight for the enclosing scope. Null outside a scope. */
function useHighlight() {
  const highlight = useContext(HighlightCtx)
  const scope = useContext(ScopeCtx)
  if (!highlight || !scope) return null
  return {
    scope,
    isActive: (n: number) =>
      highlight.active?.scope === scope && highlight.active.n === n,
    activate: (n: number | null) =>
      highlight.setActive(n === null ? null : { scope, n }),
    select: (n: number) => highlight.select(scope, n),
  }
}

const MARKER_BASE =
  "mx-0.5 inline-flex -translate-y-px items-center rounded-[5px] px-1 py-px align-baseline font-mono text-[11px] font-semibold transition-colors duration-200 outline-none"

/**
 * A bracketed `[n]` marker inside answer prose. Outside a scope (a streaming
 * answer, whose citations aren't validated yet) it renders as inert type.
 */
export function CitationMarker({ n }: { n: number }) {
  const highlight = useHighlight()

  if (!highlight) {
    return (
      <span className={cn(MARKER_BASE, "bg-citation-subtle text-citation")}>
        [{n}]
      </span>
    )
  }

  const active = highlight.isActive(n)
  return (
    <button
      type="button"
      aria-label={`Source ${n}`}
      aria-controls={rowId(highlight.scope, n)}
      onMouseEnter={() => highlight.activate(n)}
      onMouseLeave={() => highlight.activate(null)}
      onFocus={() => highlight.activate(n)}
      onBlur={() => highlight.activate(null)}
      onClick={() => {
        highlight.select(n)
        // The panel may have just switched tabs or answers, so the row lands in
        // the DOM on the next commit — scroll to it after that paint.
        requestAnimationFrame(() => revealSource(highlight.scope, n))
      }}
      className={cn(
        MARKER_BASE,
        active
          ? "bg-citation text-citation-foreground"
          : "bg-citation-subtle text-citation hover:bg-citation/25"
      )}
    >
      [{n}]
    </button>
  )
}

/** Bring the passage into view inside the panel's scroller. */
function revealSource(scope: string, n: number) {
  document
    .getElementById(rowId(scope, n))
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
}

/**
 * The passages an answer stands on: number, document, exact location, and the
 * snapshotted snippet. Hovering a row lights its marker in the prose, and vice
 * versa.
 */
export function SourceList({ sources }: { sources: Citation[] }) {
  const highlight = useHighlight()
  if (sources.length === 0) return null

  return (
    <ul className="flex flex-col gap-1.5">
      {sources.map((s) => {
        const active = highlight?.isActive(s.n) ?? false
        return (
          <li key={s.n}>
            <button
              type="button"
              id={highlight ? rowId(highlight.scope, s.n) : undefined}
              onMouseEnter={() => highlight?.activate(s.n)}
              onMouseLeave={() => highlight?.activate(null)}
              onFocus={() => highlight?.activate(s.n)}
              onBlur={() => highlight?.activate(null)}
              className={cn(
                "flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-200 outline-none",
                active
                  ? "-translate-y-px border-citation/50 bg-citation-subtle shadow-[0_6px_18px_-10px_var(--citation)]"
                  : "border-transparent bg-foreground/3 hover:bg-foreground/5.5"
              )}
            >
              <span
                className={cn(
                  "mt-px font-mono text-[11px] font-semibold transition-colors",
                  active ? "text-citation" : "text-muted-foreground"
                )}
              >
                [{s.n}]
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{s.documentName}</span>
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    p. {s.page} · chunk {s.chunkIndex}
                  </span>
                </span>
                <span className="mt-1 block text-[12px] leading-relaxed text-foreground/65 italic">
                  “{s.snippet}”
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
