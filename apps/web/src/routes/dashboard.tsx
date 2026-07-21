import { useMemo, useState } from "react"
import {
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
  Search,
} from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { useCreateProject, useProjects, type Project } from "@/lib/projects"

export function DashboardScreen() {
  const [query, setQuery] = useState("")
  const { data: projects, isPending, isError, refetch } = useProjects()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !projects) return projects ?? []
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    )
  }, [projects, query])

  return (
    <>
      <header className="flex h-[72px] shrink-0 items-center gap-5 border-b bg-card px-9">
        <h1 className="text-xl font-bold tracking-tight">Projects</h1>
        <div className="flex-1" />
        <InputGroup className="h-10 w-80 rounded-[10px] bg-secondary">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <NewProjectDialog />
      </header>

      <div className="flex-1 overflow-y-auto p-9">
        <div className="mx-auto max-w-[1140px]">
          <div className="mb-5 flex items-baseline gap-2.5">
            <h2 className="text-sm font-semibold text-muted-foreground">
              All projects
            </h2>
            {projects && (
              <span className="text-[13px] text-muted-foreground/80">
                {projects.length}{" "}
                {projects.length === 1 ? "workspace" : "workspaces"}
              </span>
            )}
          </div>

          {isPending ? (
            <LoadingState />
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState hasProjects={(projects?.length ?? 0) > 0} />
          ) : (
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
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
          {project.description || "No description"}
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

/** Create-project modal: name + optional description, then open the new project. */
function NewProjectDialog() {
  const navigate = useNavigate()
  const createProject = useCreateProject()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setName("")
      setDescription("")
      setError(null)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      const project = await createProject.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      onOpenChange(false)
      navigate(`/p/${project.id}/chat`)
    } catch {
      setError("Couldn't create the project. Please try again.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button className="h-10 rounded-[10px]">
            <Plus data-icon="inline-start" />
            New project
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              autoFocus
              required
              maxLength={120}
              placeholder="e.g. Q3 Product Strategy"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="project-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <Textarea
              id="project-description"
              rows={3}
              maxLength={500}
              placeholder="What lives in this workspace?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
            />
          </Field>

          {error && <FieldError role="alert">{error}</FieldError>}

          <DialogFooter className="mt-1">
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-[10px]"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createProject.isPending || !name.trim()}
              className="h-10 rounded-[10px]"
            >
              {createProject.isPending && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[168px] animate-pulse rounded-2xl border bg-card"
        />
      ))}
    </div>
  )
}

function EmptyState({ hasProjects }: { hasProjects: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/40 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-[13px] bg-accent text-primary">
        <FolderOpen className="size-6" strokeWidth={2} />
      </div>
      <p className="mt-4 text-[15px] font-semibold">
        {hasProjects ? "No matching projects" : "No projects yet"}
      </p>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        {hasProjects
          ? "Try a different search."
          : "Create your first project to start uploading documents and chatting with them."}
      </p>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/40 px-6 py-16 text-center">
      <p className="text-[15px] font-semibold">Couldn't load your projects</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Something went wrong reaching the server.
      </p>
      <Button
        variant="outline"
        className="mt-4 h-9 rounded-[10px]"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  )
}
