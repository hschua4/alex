import { FileText, FolderOpen, MessageSquare, Plus, Search } from "lucide-react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { projects, type Project } from "@/lib/mock-data"

export function DashboardScreen() {
  return (
    <>
      <header className="flex h-[72px] shrink-0 items-center gap-5 border-b bg-card px-9">
        <h1 className="text-xl font-bold tracking-tight">Projects</h1>
        <div className="flex-1" />
        <InputGroup className="h-10 w-80 rounded-[10px] bg-secondary">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search projects…" />
        </InputGroup>
        <Button className="h-10 rounded-[10px]">
          <Plus data-icon="inline-start" />
          New project
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-9">
        <div className="mx-auto max-w-[1140px]">
          <div className="mb-5 flex items-baseline gap-2.5">
            <h2 className="text-sm font-semibold text-muted-foreground">
              All projects
            </h2>
            <span className="text-[13px] text-muted-foreground/80">
              {projects.length} workspaces
            </span>
          </div>

          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/p/${project.id}/chat`}
      className="group flex flex-col gap-4 rounded-2xl border bg-card p-[22px] transition-all hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-[0_8px_24px_-8px_oklch(0.55_0.05_264_/_0.25)]"
    >
      <div className="flex items-start justify-between">
        <div
          className="flex size-11 items-center justify-center rounded-xl"
          style={{ background: project.tint.bg, color: project.tint.fg }}
        >
          <FolderOpen className="size-[22px]" strokeWidth={2} />
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {project.updatedLabel}
        </span>
      </div>

      <div>
        <h3 className="mb-1.5 text-[16.5px] font-bold leading-tight tracking-tight">
          {project.name}
        </h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {project.description}
        </p>
      </div>

      <div className="flex items-center gap-4 border-t pt-3.5 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <FileText className="size-[15px]" strokeWidth={2} />
          {project.docCount} docs
        </span>
        <span className="flex items-center gap-1.5">
          <MessageSquare className="size-[15px]" strokeWidth={2} />
          {project.chatCount} chats
        </span>
      </div>
    </Link>
  )
}
