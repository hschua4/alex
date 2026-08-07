import { cn } from "@/lib/utils"

/**
 * The product mark: the citation bracket itself, the one idea Alex is built on.
 * Shared by the landing surface and the app so the identity survives sign-in.
 *
 * Brackets default to `--mark` (the landing's fixed ochre), which reads on dark
 * grounds — the landing sheet and the rail. On light app surfaces pass
 * `bracketClassName="text-citation"`, the theme-tuned counterpart.
 */
export function Wordmark({
  className,
  bracketClassName = "text-mark",
}: {
  className?: string
  bracketClassName?: string
}) {
  return (
    <span
      className={cn(
        "flex items-baseline gap-1.5 font-mono text-[15px] font-semibold tracking-tight",
        className
      )}
    >
      <span className={bracketClassName}>[</span>
      alex
      <span className={bracketClassName}>]</span>
    </span>
  )
}

/**
 * Compact form for the 60px rail, where the full wordmark cannot fit: the
 * brackets survive, the word contracts to its initial.
 */
export function WordmarkGlyph({
  className,
  bracketClassName = "text-mark",
}: {
  className?: string
  bracketClassName?: string
}) {
  return (
    <span
      aria-label="Alex"
      className={cn(
        "flex size-[34px] items-center justify-center font-mono text-[17px] font-semibold tracking-tighter",
        className
      )}
    >
      <span className={bracketClassName}>[</span>a
      <span className={bracketClassName}>]</span>
    </span>
  )
}
