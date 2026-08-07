import { Children, memo, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

/**
 * Renders assistant markdown (GFM) while preserving the "[n]" citation markers
 * as clickable superscripts. Citations are the app's own convention layered on
 * top of the model's markdown, so we post-process text nodes rather than teach
 * the markdown parser about them.
 */
export const Markdown = memo(function Markdown({
  children,
  onCitationClick,
  className,
}: {
  children: string
  onCitationClick?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "text-[14.5px] leading-[1.65] text-foreground/90",
        // spacing between block elements; first/last trimmed so bubbles hug tight
        "[&>*]:my-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents(onCitationClick)}>
        {children}
      </ReactMarkdown>
    </div>
  )
})

/** Split string nodes on "[n]" markers, rendering each marker as a superscript. */
function withCitations(children: ReactNode, onClick?: () => void): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child
    const parts = child.split(/(\[\d+\])/g)
    return parts.map((part, i) => {
      const match = /^\[(\d+)\]$/.exec(part)
      if (!match) return part
      return (
        <button
          key={i}
          type="button"
          onClick={onClick}
          className="mx-0.5 -translate-y-1 align-super text-[10px] font-bold text-citation hover:underline"
        >
          [{match[1]}]
        </button>
      )
    })
  })
}

function buildComponents(onCitationClick?: () => void): Components {
  const cite = (children: ReactNode) => withCitations(children, onCitationClick)

  return {
    p: ({ children }) => <p>{cite(children)}</p>,
    strong: ({ children }) => <strong className="font-semibold">{cite(children)}</strong>,
    em: ({ children }) => <em className="italic">{cite(children)}</em>,
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-primary underline underline-offset-2"
      >
        {cite(children)}
      </a>
    ),
    ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }) => <li className="pl-0.5">{cite(children)}</li>,
    h1: ({ children }) => (
      <h1 className="text-[19px] font-bold tracking-tight text-foreground">{cite(children)}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-[17px] font-bold tracking-tight text-foreground">{cite(children)}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-[15px] font-semibold text-foreground">{cite(children)}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-[14.5px] font-semibold text-foreground">{cite(children)}</h4>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-[3px] border-border pl-3.5 text-foreground/70">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-border" />,
    code: ({ className, children }) => {
      // react-markdown tags block code with a `language-*` class; anything else
      // is inline. Code is rendered verbatim — no citation post-processing.
      const isBlock = /language-/.test(className ?? "")
      if (isBlock) {
        return (
          <code className={cn("font-mono text-[13px]", className)}>{children}</code>
        )
      }
      return (
        <code className="rounded-[5px] bg-secondary px-1.5 py-0.5 font-mono text-[13px] text-foreground/90">
          {children}
        </code>
      )
    },
    pre: ({ children }) => (
      <pre className="overflow-x-auto rounded-xl border bg-secondary p-3.5 leading-relaxed">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
    th: ({ children }) => (
      <th className="px-3 py-1.5 text-left font-semibold">{cite(children)}</th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border px-3 py-1.5">{cite(children)}</td>
    ),
  }
}
