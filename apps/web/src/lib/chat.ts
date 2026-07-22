import { useCallback, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { api } from "./api"

/**
 * The live end of the chat seam (ADR-0009), replacing the mock chats/messages in
 * `mock-data.ts`. Read paths (models, sessions, message history) go through the
 * typed `hc` client; the grounded-answer turn streams over Server-Sent Events, so
 * it uses a raw `fetch` reader (`useChatStream`) — the cookie rides along
 * same-origin. Presentation (relative-time labels) is derived here, client-side.
 */

// ── models (ADR-0010) ────────────────────────────────────────────────────────

export type AnswerModel = { id: string; label: string }

/** The server's answer-model allowlist + default. The picker can only show these. */
export function useModels() {
  return useQuery({
    queryKey: ["chat", "models"],
    staleTime: Infinity,
    queryFn: async (): Promise<{ models: AnswerModel[]; default: string }> => {
      const res = await api.chat.models.$get()
      if (!res.ok) throw new Error("Failed to load models")
      const data = await res.json()
      // The server list is `readonly`; hand the UI a mutable copy.
      return { models: [...data.models], default: data.default }
    },
  })
}

// ── sessions ─────────────────────────────────────────────────────────────────

export type ChatSession = {
  id: string
  title: string
  updatedLabel: string
}

type ChatSessionDto = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

function formatRelative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "Just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

function toSession(dto: ChatSessionDto): ChatSession {
  return { id: dto.id, title: dto.title, updatedLabel: formatRelative(dto.updatedAt) }
}

export const sessionsKey = (projectId: string) =>
  ["chat", "sessions", projectId] as const

/** A project's chat sessions, newest first — the history sidebar. */
export function useSessions(projectId: string) {
  return useQuery({
    queryKey: sessionsKey(projectId),
    enabled: projectId !== "",
    queryFn: async (): Promise<ChatSession[]> => {
      const res = await api.projects[":projectId"].chat.sessions.$get({
        param: { projectId },
      })
      if (!res.ok) throw new Error("Failed to load chats")
      const { sessions } = await res.json()
      return sessions.map(toSession)
    },
  })
}

// ── messages ─────────────────────────────────────────────────────────────────

export type Citation = {
  n: number
  documentId: string
  documentName: string
  page: number
  chunkIndex: number
  snippet: string
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  status: "complete" | "stopped" | "failed"
  citations: Citation[]
}

type MessageDto = {
  id: string
  role: "user" | "assistant"
  content: string
  status: "complete" | "stopped" | "failed"
  selectedDocumentIds: string[]
  modelId: string | null
  citations: Citation[]
  createdAt: string
}

export const messagesKey = (sessionId: string) =>
  ["chat", "messages", sessionId] as const

/** The messages of a session, in order, each with its validated citations. */
export function useMessages(sessionId: string | undefined) {
  return useQuery({
    queryKey: messagesKey(sessionId ?? ""),
    enabled: !!sessionId,
    queryFn: async (): Promise<ChatMessage[]> => {
      const res = await api.projects[":projectId"].chat.sessions[
        ":sessionId"
      ].messages.$get({
        // projectId isn't used by the handler (it scopes by session+user), but
        // the typed route requires the param.
        param: { projectId: "_", sessionId: sessionId! },
      })
      if (!res.ok) throw new Error("Failed to load messages")
      const { messages } = await res.json()
      return (messages as MessageDto[]).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        status: m.status,
        citations: m.citations,
      }))
    },
  })
}

// ── the grounded-answer turn (streamed over SSE) ─────────────────────────────

/** The in-flight turn: the user's message and the answer accumulating live. */
export type PendingTurn = {
  userContent: string
  assistantText: string
  error?: string
}

type SendInput = {
  content: string
  selectedDocumentIds: string[]
  model: string
  /** The current session, or undefined to open a new one on the first turn. */
  sessionId?: string
}

/** Split a growing SSE buffer into complete `{event, data}` records. */
function drainEvents(buffer: string): { events: SSERecord[]; rest: string } {
  const events: SSERecord[] = []
  let rest = buffer
  let sep = rest.indexOf("\n\n")
  while (sep !== -1) {
    const block = rest.slice(0, sep)
    rest = rest.slice(sep + 2)
    const event = /^event:\s*(.+)$/m.exec(block)?.[1]
    const data = /^data:\s*(.+)$/m.exec(block)?.[1]
    if (event && data) events.push({ event, data: JSON.parse(data) })
    sep = rest.indexOf("\n\n")
  }
  return { events, rest }
}

type SSERecord = { event: string; data: Record<string, unknown> }

/**
 * Stream a grounded answer for one turn (CONTEXT §4). Posts the turn, then reads
 * the SSE stream: `start` carries the (possibly new) session id — on a new chat we
 * route to it immediately; `delta` events grow the live answer; `done` fires after
 * the server has persisted and validated the assistant message, so we refetch the
 * session's messages (now with citations) and clear the live turn. Returns the
 * pending turn so the UI can render the user bubble and the streaming answer.
 */
export function useChatStream(projectId: string) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [pending, setPending] = useState<PendingTurn | null>(null)

  const send = useCallback(
    async (input: SendInput) => {
      setPending({ userContent: input.content, assistantText: "" })
      let sessionId = input.sessionId

      try {
        const res = await fetch(`/api/projects/${projectId}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: input.sessionId,
            content: input.content,
            selectedDocumentIds: input.selectedDocumentIds,
            model: input.model,
          }),
        })
        if (!res.ok || !res.body) {
          throw new Error("The answer could not be generated.")
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const { events, rest } = drainEvents(buffer)
          buffer = rest
          for (const { event, data } of events) {
            if (event === "start") {
              sessionId = data.sessionId as string
              if (!input.sessionId) {
                navigate(`/p/${projectId}/chat/${sessionId}`, { replace: true })
              }
            } else if (event === "delta") {
              const text = data.text as string
              setPending((p) =>
                p ? { ...p, assistantText: p.assistantText + text } : p,
              )
            }
            // `done` needs no client work: the message is already persisted; the
            // refetch below picks it up with its validated citations.
          }
        }

        // Persisted answer + updated session ordering are now authoritative.
        if (sessionId) {
          await queryClient.invalidateQueries({
            queryKey: messagesKey(sessionId),
          })
        }
        await queryClient.invalidateQueries({ queryKey: sessionsKey(projectId) })
        queryClient.invalidateQueries({ queryKey: ["projects"] })
        setPending(null)
      } catch (err) {
        setPending((p) =>
          p
            ? {
                ...p,
                error:
                  err instanceof Error ? err.message : "Something went wrong.",
              }
            : p,
        )
      }
    },
    [projectId, navigate, queryClient],
  )

  const dismissError = useCallback(() => setPending(null), [])

  return { pending, send, dismissError, isStreaming: pending !== null }
}
