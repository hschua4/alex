import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { api } from "./api"
import type { Tint } from "./mock-data"

/**
 * The live end of the projects seam (ADR-0009). Where `mock-data.ts` once held a
 * hard-coded `projects` array, these hooks read the real, user-scoped API through
 * the typed `hc` client. The API returns raw data (ids, ISO dates, counts); the
 * *presentation* the dashboard needs — a decorative tint and a relative-time
 * label — is derived here, client-side, so the server stays free of display
 * concerns.
 */

/** The shape the project UI renders. Server data + derived display fields. */
export type Project = {
  id: string
  name: string
  description: string
  docCount: number
  chatCount: number
  updatedLabel: string
  tint: Tint
}

/** Decorative per-hue tints, chosen deterministically from a project's id. */
const PROJECT_TINTS: Tint[] = [
  { bg: "oklch(0.94 0.05 264)", fg: "oklch(0.5 0.17 264)" },
  { bg: "oklch(0.94 0.05 160)", fg: "oklch(0.48 0.13 160)" },
  { bg: "oklch(0.94 0.05 25)", fg: "oklch(0.5 0.16 25)" },
  { bg: "oklch(0.94 0.05 300)", fg: "oklch(0.5 0.15 300)" },
  { bg: "oklch(0.94 0.05 65)", fg: "oklch(0.5 0.14 65)" },
  { bg: "oklch(0.94 0.05 200)", fg: "oklch(0.48 0.13 200)" },
]

/** Stable tint for a project: hash the id so a project keeps its color. */
function projectTint(id: string): Tint {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return PROJECT_TINTS[Math.abs(hash) % PROJECT_TINTS.length]
}

/** Humanize an ISO timestamp into the "2h ago" label the cards show. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return "Just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

/** The API's project DTO (ISO dates, no display fields) → the UI `Project`. */
type ProjectDto = {
  id: string
  name: string
  description: string
  docCount: number
  chatCount: number
  createdAt: string
  updatedAt: string
}

function toProject(dto: ProjectDto): Project {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    docCount: dto.docCount,
    chatCount: dto.chatCount,
    updatedLabel: formatRelative(dto.updatedAt),
    tint: projectTint(dto.id),
  }
}

const projectsKey = ["projects"] as const

/** All of the signed-in user's projects, for the dashboard. */
export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: async (): Promise<Project[]> => {
      const res = await api.projects.$get()
      if (!res.ok) throw new Error("Failed to load projects")
      const { projects } = await res.json()
      return projects.map(toProject)
    },
  })
}

/**
 * A single project by id. The project-scoped shell (documents + chat) resolves a
 * real project through this instead of reading a mock. A 404 (missing, or not
 * owned by this user) surfaces as `null` so the caller can redirect.
 */
export function useProject(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    enabled: projectId !== "",
    queryFn: async (): Promise<Project | null> => {
      const res = await api.projects[":id"].$get({ param: { id: projectId } })
      if (res.status === 404) return null
      if (!res.ok) throw new Error("Failed to load project")
      const { project } = await res.json()
      return toProject(project)
    },
  })
}

/** Create a project, then refresh the dashboard list. Resolves to the new one. */
export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      description?: string
    }): Promise<Project> => {
      const res = await api.projects.$post({ json: input })
      if (!res.ok) throw new Error("Failed to create project")
      const { project } = await res.json()
      return toProject(project)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectsKey })
    },
  })
}
