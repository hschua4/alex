import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "./api"
import type { DocStatus, DocType } from "./mock-data"

/**
 * The live end of the documents seam (ADR-0009), the counterpart to
 * `lib/projects.ts`. The documents *route* reads real, user-scoped ingestion
 * status through the typed `hc` client instead of the mock array; the chat
 * document-picker stays on the mock until its own slice (#5). Presentation
 * (size/date labels, uppercase type) is derived here, client-side.
 */

/** The shape the documents table renders. Server data + derived display fields. */
export type Document = {
  id: string
  filename: string
  type: DocType
  status: DocStatus
  errorMessage: string | null
  pageCount: number
  sizeLabel: string
  addedLabel: string
}

/** The API's document DTO (raw bytes, ISO date, lowercase type). */
type DocumentDto = {
  id: string
  filename: string
  fileType: string
  sizeBytes: number
  pageCount: number
  status: DocStatus
  errorMessage: string | null
  createdAt: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatAdded(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

function toDocument(dto: DocumentDto): Document {
  return {
    id: dto.id,
    filename: dto.filename,
    type: dto.fileType.toUpperCase() as DocType,
    status: dto.status,
    errorMessage: dto.errorMessage,
    pageCount: dto.pageCount,
    sizeLabel: formatBytes(dto.sizeBytes),
    addedLabel: formatAdded(dto.createdAt),
  }
}

const documentsKey = (projectId: string) => ["documents", projectId] as const

/**
 * A project's documents. While any document is still `processing`, poll so the
 * status badge flips to `indexed`/`failed` live without a manual refresh; once
 * everything is settled, stop polling.
 */
export function useDocuments(projectId: string) {
  return useQuery({
    queryKey: documentsKey(projectId),
    enabled: projectId !== "",
    queryFn: async (): Promise<Document[]> => {
      const res = await api.projects[":projectId"].documents.$get({
        param: { projectId },
      })
      if (!res.ok) throw new Error("Failed to load documents")
      const { documents } = await res.json()
      return documents.map(toDocument)
    },
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === "processing") ? 2500 : false,
  })
}

/** Human-friendly messages for the boundary rejections the API can return. */
const UPLOAD_ERRORS: Record<string, string> = {
  too_large: "File is too large (max 20 MB).",
  too_many_pages: "PDF has too many pages (max 300).",
  unsupported_type: "Only PDF and Word (.docx) files are supported.",
  unreadable_pdf: "That PDF could not be read.",
  file_required: "No file was provided.",
}

/**
 * Upload a file into a project. Uses a raw `fetch` (not `hc`) because this is a
 * multipart body; the cookie rides along same-origin. Invalidates the documents
 * list and the dashboard counts on success.
 */
export function useUploadDocument(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File): Promise<void> => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const code = await res
          .json()
          .then((b: { error?: string }) => b.error)
          .catch(() => undefined)
        throw new Error(
          (code && UPLOAD_ERRORS[code]) ?? "Upload failed. Please try again.",
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsKey(projectId) })
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      queryClient.invalidateQueries({ queryKey: ["project", projectId] })
    },
  })
}

/** Re-enqueue ingestion for a document (recover a `failed`, or re-index). */
export function useReingestDocument(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await api.projects[":projectId"].documents[":id"].reingest.$post(
        { param: { projectId, id } },
      )
      if (!res.ok) throw new Error("Failed to re-ingest document")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsKey(projectId) })
    },
  })
}

/** Delete a document (original + chunks). Refreshes the list and counts. */
export function useDeleteDocument(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await api.projects[":projectId"].documents[":id"].$delete({
        param: { projectId, id },
      })
      if (!res.ok) throw new Error("Failed to delete document")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsKey(projectId) })
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      queryClient.invalidateQueries({ queryKey: ["project", projectId] })
    },
  })
}
