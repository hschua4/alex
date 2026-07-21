import { useRef } from "react"
import {
  FileText,
  Loader2,
  MessageSquare,
  MoreVertical,
  RotateCw,
  Trash2,
  Upload,
} from "lucide-react"
import { Link, Navigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { DocBadge } from "@/components/doc-badge"
import { ProjectSidebarHeader } from "@/components/project-sidebar-header"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useDeleteDocument,
  useDocuments,
  useReingestDocument,
  useUploadDocument,
  type Document,
} from "@/lib/documents"
import { STATUS_META } from "@/lib/mock-data"
import { useProject } from "@/lib/projects"
import { cn } from "@/lib/utils"

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const ACCEPT = ".pdf,.docx"

export function DocumentsScreen() {
  const { projectId = "" } = useParams()
  const { data: project, isPending } = useProject(projectId)
  const documents = useDocuments(projectId)
  const upload = useUploadDocument(projectId)
  const fileInput = useRef<HTMLInputElement>(null)

  if (isPending) return <ProjectLoading />
  if (!project) return <Navigate to="/" replace />

  const pickFiles = () => fileInput.current?.click()

  const onFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name} is too large (max 20 MB).`)
        continue
      }
      upload.mutate(file, {
        onSuccess: () => toast.success(`Uploaded ${file.name}`),
        onError: (err) => toast.error(err.message),
      })
    }
    if (fileInput.current) fileInput.current.value = ""
  }

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
          <Button
            className="h-[38px] rounded-[10px]"
            onClick={pickFiles}
            disabled={upload.isPending}
          >
            {upload.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Upload data-icon="inline-start" />
            )}
            Upload
          </Button>
        </header>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />

        <div className="flex-1 overflow-y-auto px-8 py-7">
          <Dropzone onPick={pickFiles} onFiles={onFiles} busy={upload.isPending} />
          {documents.isPending ? (
            <TableSkeleton />
          ) : documents.isError ? (
            <EmptyState message="Couldn't load documents. Retry shortly." />
          ) : documents.data.length === 0 ? (
            <EmptyState message="No documents yet. Upload a PDF or Word file to get started." />
          ) : (
            <DocumentsTable documents={documents.data} projectId={projectId} />
          )}
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

function Dropzone({
  onPick,
  onFiles,
  busy,
}: {
  onPick: () => void
  onFiles: (files: FileList | null) => void
  busy: boolean
}) {
  return (
    <div
      className="mb-6 flex items-center gap-[18px] rounded-[14px] border-2 border-dashed bg-card/40 p-7 transition-colors hover:border-primary/40"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onFiles(e.dataTransfer.files)
      }}
    >
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
      <Button
        variant="outline"
        className="h-9 rounded-[9px]"
        onClick={onPick}
        disabled={busy}
      >
        Browse files
      </Button>
    </div>
  )
}

const GRID = "grid-cols-[44px_1fr_130px_90px_110px_40px]"

function DocumentsTable({
  documents,
  projectId,
}: {
  documents: Document[]
  projectId: string
}) {
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
        <DocumentRow key={doc.id} doc={doc} projectId={projectId} />
      ))}
    </div>
  )
}

function DocumentRow({ doc, projectId }: { doc: Document; projectId: string }) {
  const status = STATUS_META[doc.status]
  const reingest = useReingestDocument(projectId)
  const remove = useDeleteDocument(projectId)

  return (
    <div
      className={cn(
        "grid items-center border-t px-5 py-3 text-sm transition-colors first:border-t-0 hover:bg-secondary/60",
        GRID
      )}
    >
      <DocBadge type={doc.type} size="lg" />
      <div className="min-w-0 pr-4">
        <p className="truncate font-semibold">{doc.filename}</p>
        <p className="mt-px text-xs text-muted-foreground">
          {doc.status === "failed" && doc.errorMessage
            ? doc.errorMessage
            : `${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}`}
        </p>
      </div>
      <div>
        <span
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium"
          style={{ color: status.colorVar }}
        >
          {doc.status === "processing" ? (
            <Loader2 className="size-[11px] animate-spin" />
          ) : (
            <span
              className="size-[7px] rounded-full"
              style={{ background: status.colorVar }}
            />
          )}
          {status.label}
        </span>
      </div>
      <div className="text-[13px] text-muted-foreground">{doc.sizeLabel}</div>
      <div className="text-[13px] text-muted-foreground">{doc.addedLabel}</div>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Document actions"
          className="flex justify-center text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none"
        >
          <MoreVertical className="size-[18px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={doc.status === "processing" || reingest.isPending}
            onClick={() =>
              reingest.mutate(doc.id, {
                onError: (err) => toast.error(err.message),
              })
            }
          >
            <RotateCw />
            Re-ingest
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(doc.id, {
                onSuccess: () => toast.success(`Deleted ${doc.filename}`),
                onError: (err) => toast.error(err.message),
              })
            }
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed bg-card/40 px-8 py-16 text-center">
      <FileText className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-[14px] border bg-card">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className={cn("grid items-center border-t px-5 py-4 first:border-t-0", GRID)}
        >
          <div className="size-8 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          <div className="h-4 w-12 animate-pulse rounded bg-muted" />
          <div className="h-4 w-14 animate-pulse rounded bg-muted" />
          <div />
        </div>
      ))}
    </div>
  )
}
