import { ChevronLeft } from "lucide-react"
import { Link } from "react-router-dom"

import type { Project } from "@/lib/mock-data"

/** Shared top of the project-scoped sidebar: back link + name + counts. */
export function ProjectSidebarHeader({ project }: { project: Project }) {
  return (
    <>
      <Link
        to="/"
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
    </>
  )
}
