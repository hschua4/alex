import { useCallback, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { api } from "./api"

/** The remembered answer-model pick, per ADR-0010 ("remember the last pick"). */
export const MODEL_STORAGE_KEY = "alex.answerModel"

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

/**
 * The effective answer model (ADR-0010): the user's remembered pick, falling back
 * to the server default whenever nothing is stored or the stored id has dropped
 * off the allowlist. Derived, never held in an effect. Shared by the composer and
 * the regenerate action so both send the same model.
 */
export function useAnswerModel() {
  const { data } = useModels()
  const [picked, setPicked] = useState<string | null>(() =>
    localStorage.getItem(MODEL_STORAGE_KEY)
  )
  const models = data?.models ?? []
  const ids = models.map((m) => m.id)
  const model = picked && ids.includes(picked) ? picked : (data?.default ?? "")
  const pick = useCallback((id: string) => {
    setPicked(id)
    localStorage.setItem(MODEL_STORAGE_KEY, id)
  }, [])
  const activeLabel = models.find((m) => m.id === model)?.label ?? "Model"
  return { model, models, pick, activeLabel }
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
  return {
    id: dto.id,
    title: dto.title,
    updatedLabel: formatRelative(dto.updatedAt),
  }
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
  /** Set when this answer supersedes an earlier one (CONTEXT §4.6); else null. */
  regeneratedFrom: string | null
  /** The answer model that produced this turn (ADR-0010). Null on user turns. */
  modelId: string | null
  citations: Citation[]
}

type MessageDto = {
  id: string
  role: "user" | "assistant"
  content: string
  status: "complete" | "stopped" | "failed"
  selectedDocumentIds: string[]
  modelId: string | null
  regeneratedFrom: string | null
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
        regeneratedFrom: m.regeneratedFrom,
        modelId: m.modelId,
        citations: m.citations,
      }))
    },
  })
}

// ── the grounded-answer turn (streamed over SSE) ─────────────────────────────

/**
 * The in-flight turn: the answer accumulating live. `userContent` is the user
 * bubble to render on a fresh send; a *regenerate* omits it (no new question) and
 * instead names the answer it is replacing so the transcript can hide it while the
 * new one streams in its place.
 */
export type PendingTurn = {
  userContent?: string
  assistantText: string
  regeneratingFrom?: string
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

type RegenerateInput = {
  /** The assistant message being re-answered; the new answer replaces it in view. */
  messageId: string
  model: string
  sessionId: string
}

/**
 * Stream a grounded answer for one turn (CONTEXT §4), for both a fresh send and a
 * regenerate. Posts the turn, then reads the SSE stream: `start` carries the
 * (possibly new) session id — on a new chat we route to it immediately; `delta`
 * events grow the live answer; on stream-end the server has already persisted and
 * validated the assistant message, so we refetch the session's messages (now with
 * citations) and clear the live turn.
 *
 * `stop()` aborts the in-flight request; the server keeps the partial answer as
 * `stopped` (CONTEXT §4.6), so an abort is a normal end, not an error — we refetch
 * and clear rather than surfacing a failure.
 */
export function useChatStream(projectId: string) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [pending, setPending] = useState<PendingTurn | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const runStream = useCallback(
    async (
      url: string,
      body: unknown,
      opts: { seed: PendingTurn; sessionId?: string; isNewSession: boolean }
    ) => {
      setPending(opts.seed)
      let sessionId = opts.sessionId
      const controller = new AbortController()
      controllerRef.current = controller

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
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
              if (opts.isNewSession) {
                navigate(`/p/${projectId}/chat/${sessionId}`, { replace: true })
              }
            } else if (event === "delta") {
              const text = data.text as string
              setPending((p) =>
                p ? { ...p, assistantText: p.assistantText + text } : p
              )
            }
            // `done` needs no client work: the message is already persisted; the
            // refetch below picks it up with its validated citations.
          }
        }

        await settle(sessionId)
      } catch (err) {
        // An abort is a deliberate stop: the server persisted the partial as
        // `stopped`, so refetch and clear rather than showing an error.
        if (controller.signal.aborted) {
          await settle(sessionId)
          return
        }
        setPending((p) =>
          p
            ? {
                ...p,
                error:
                  err instanceof Error ? err.message : "Something went wrong.",
              }
            : p
        )
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }

      // Persisted answer + updated session ordering are now authoritative.
      async function settle(id: string | undefined) {
        if (id) {
          await queryClient.invalidateQueries({ queryKey: messagesKey(id) })
        }
        await queryClient.invalidateQueries({
          queryKey: sessionsKey(projectId),
        })
        queryClient.invalidateQueries({ queryKey: ["projects"] })
        setPending(null)
      }
    },
    [projectId, navigate, queryClient]
  )

  const send = useCallback(
    (input: SendInput) =>
      runStream(
        `/api/projects/${projectId}/chat`,
        {
          sessionId: input.sessionId,
          content: input.content,
          selectedDocumentIds: input.selectedDocumentIds,
          model: input.model,
        },
        {
          seed: { userContent: input.content, assistantText: "" },
          sessionId: input.sessionId,
          isNewSession: !input.sessionId,
        }
      ),
    [projectId, runStream]
  )

  const regenerate = useCallback(
    (input: RegenerateInput) =>
      runStream(
        `/api/projects/${projectId}/chat/messages/${input.messageId}/regenerate`,
        { model: input.model },
        {
          seed: { assistantText: "", regeneratingFrom: input.messageId },
          sessionId: input.sessionId,
          isNewSession: false,
        }
      ),
    [projectId, runStream]
  )

  const stop = useCallback(() => controllerRef.current?.abort(), [])
  const dismissError = useCallback(() => setPending(null), [])

  return {
    pending,
    send,
    regenerate,
    stop,
    dismissError,
    isStreaming: pending !== null,
  }
}
