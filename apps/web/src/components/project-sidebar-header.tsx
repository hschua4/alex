import { ChevronLeft, FileText, MessageSquare } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import type { Project } from "@/lib/projects"
import { cn } from "@/lib/utils"

/**
 * Shared top of the project-scoped sidebar: back link + name + counts, plus the
 * Chats/Documents sub-nav. Rendered by both the chat and documents screens so
 * the two mirror each other and each is reachable from the other.
 */
export function ProjectSidebarHeader({ project }: { project: Project }) {
  const { pathname } = useLocation()
  const onDocuments = pathname.startsWith(`/p/${project.id}/documents`)

  return (
    <>
      <Link
        to="/app"
        className="flex items-center gap-2 px-5 pb-3.5 pt-[18px] text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-[15px]" strokeWidth={2.2} />
        All projects
      </Link>
      <div className="border-b px-5 pb-4">
        <h2 className="text-[17px] font-bold tracking-tight">{project.name}</h2>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {project.docCount} documents · {project.chatCount} chats
        </p>
      </div>
      <nav className="flex flex-col gap-0.5 border-b p-3">
        <NavItem
          to={`/p/${project.id}/chat`}
          active={!onDocuments}
          icon={MessageSquare}
          label="Chats"
        />
        <NavItem
          to={`/p/${project.id}/documents`}
          active={onDocuments}
          icon={FileText}
          label="Documents"
        />
      </nav>
    </>
  )
}

function NavItem({
  to,
  active,
  icon: Icon,
  label,
}: {
  to: string
  active: boolean
  icon: typeof FileText
  label: string
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-accent font-semibold text-accent-foreground"
          : "font-medium text-foreground/70 hover:bg-secondary"
      )}
    >
      <Icon className="size-[17px]" strokeWidth={2} />
      {label}
    </Link>
  )
}
