import { DOC_TINTS, type DocType } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

/** File-type chip (PDF / DOCX) in its type tint. Sizes match the prototype. */
export function DocBadge({
  type,
  size = "md",
  className,
}: {
  type: DocType
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const tint = DOC_TINTS[type]
  const dims =
    size === "sm"
      ? "size-4 rounded-[4px] text-[8px]"
      : size === "lg"
        ? "size-8 rounded-lg text-[9.5px]"
        : "size-[30px] rounded-lg text-[9px]"

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center font-mono font-bold",
        dims,
        className
      )}
      style={{ background: tint.bg, color: tint.fg }}
    >
      {type}
    </span>
  )
}
