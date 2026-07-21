import { FileText, Loader2, MessageSquare, MoreVertical, Upload } from "lucide-react"
import { Link, Navigate, useParams } from "react-router-dom"

import { DocBadge } from "@/components/doc-badge"
import { ProjectSidebarHeader } from "@/components/project-sidebar-header"
import { Button } from "@/components/ui/button"
import { getDocuments, STATUS_META, type Doc } from "@/lib/mock-data"
import { useProject } from "@/lib/projects"
import { cn } from "@/lib/utils"

export function DocumentsScreen() {
  const { projectId = "" } = useParams()
  const { data: project, isPending } = useProject(projectId)
  if (isPending) return <ProjectLoading />
  if (!project) return <Navigate to="/" replace />
  const documents = getDocuments(projectId)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* project sub-nav */}
      <aside className="flex w-[264px] shrink-0 flex-col border-r bg-card">
        <ProjectSidebarHeader project={project} />
        <nav className="flex flex-col gap-0.5 p-3">
          <Link
            to={`/p/${projectId}/chat`}
            className="flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm font-medium text-foreground/70 transition-colors hover:bg-secondary"
          >
            <MessageSquare className="size-[17px]" strokeWidth={2} />
            Chats
          </Link>
          <span className="flex items-center gap-3 rounded-[9px] bg-accent px-3 py-2.5 text-sm font-semibold text-accent-foreground">
            <FileText className="size-[17px]" strokeWidth={2} />
            Documents
          </span>
        </nav>
      </aside>

      {/* documents main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-[72px] shrink-0 items-center border-b bg-card px-8">
          <h1 className="text-[19px] font-bold tracking-tight">Documents</h1>
          <div className="flex-1" />
          <Button className="h-[38px] rounded-[10px]">
            <Upload data-icon="inline-start" />
            Upload
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-7">
          <Dropzone />
          <DocumentsTable documents={documents} />
        </div>
      </div>
    </div>
  )
}

function ProjectLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

function Dropzone() {
  return (
    <div className="mb-6 flex items-center gap-[18px] rounded-[14px] border-2 border-dashed bg-card/40 p-7">
      <div className="flex size-[52px] items-center justify-center rounded-[13px] bg-accent text-primary">
        <Upload className="size-6" strokeWidth={2} />
      </div>
      <div className="flex-1">
        <p className="text-[15px] font-semibold">
          Drop files here or click to upload
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          PDF and Word (.docx) up to 20 MB each · Documents are chunked and
          indexed automatically
        </p>
      </div>
      <Button variant="outline" className="h-9 rounded-[9px]">
        Browse files
      </Button>
    </div>
  )
}

const GRID = "grid-cols-[44px_1fr_130px_90px_110px_40px]"

function DocumentsTable({ documents }: { documents: Doc[] }) {
  return (
    <div className="overflow-hidden rounded-[14px] border bg-card">
      <div
        className={cn(
          "grid items-center gap-0 bg-secondary px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground",
          GRID
        )}
      >
        <div />
        <div>Name</div>
        <div>Status</div>
        <div>Size</div>
        <div>Added</div>
        <div />
      </div>
      {documents.map((doc) => (
        <DocumentRow key={doc.id} doc={doc} />
      ))}
    </div>
  )
}

function DocumentRow({ doc }: { doc: Doc }) {
  const status = STATUS_META[doc.status]
  return (
    <div
      className={cn(
        "grid items-center border-t px-5 py-3 text-sm transition-colors first:border-t-0 hover:bg-secondary/60",
        GRID
      )}
    >
      <DocBadge type={doc.type} size="lg" />
      <div className="min-w-0 pr-4">
        <p className="truncate font-semibold">{doc.name}</p>
        <p className="mt-px text-xs text-muted-foreground">{doc.pages} pages</p>
      </div>
      <div>
        <span
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium"
          style={{ color: status.colorVar }}
        >
          <span
            className="size-[7px] rounded-full"
            style={{ background: status.colorVar }}
          />
          {status.label}
        </span>
      </div>
      <div className="text-[13px] text-muted-foreground">{doc.sizeLabel}</div>
      <div className="text-[13px] text-muted-foreground">{doc.addedLabel}</div>
      <button
        type="button"
        aria-label="Document actions"
        className="flex justify-center text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        <MoreVertical className="size-[18px]" />
      </button>
    </div>
  )
}
