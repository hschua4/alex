import { useEffect, useRef, useState } from "react"
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Square,
} from "lucide-react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"

import { DocBadge } from "@/components/doc-badge"
import { ProjectSidebarHeader } from "@/components/project-sidebar-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  useAnswerModel,
  useChatStream,
  useMessages,
  useSessions,
  type ChatMessage,
  type ChatSession,
  type Citation,
} from "@/lib/chat"
import { useDocuments, type Document } from "@/lib/documents"
import { useProject, type Project } from "@/lib/projects"
import { cn } from "@/lib/utils"

export function ChatScreen() {
  const { projectId = "", chatId } = useParams()
  const { data: project, isPending } = useProject(projectId)

  const { data: sessions = [] } = useSessions(projectId)
  const { data: documents = [] } = useDocuments(projectId)
  const { data: messages = [] } = useMessages(chatId)
  const { pending, send, regenerate, stop, isStreaming } =
    useChatStream(projectId)
  const answerModel = useAnswerModel()

  const [tab, setTab] = useState<"documents" | "sources">("documents")

  // Default the selection to every indexed document, once, when they first load.
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current || documents.length === 0) return
    initialized.current = true
    setSelected(new Set(documents.filter((d) => d.status === "indexed").map((d) => d.id)))
  }, [documents])
  const selectedIds = selected ?? new Set<string>()

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center bg-secondary">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!project) return <Navigate to="/" replace />

  function toggleDoc(id: string) {
    setSelected((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const activeSession = sessions.find((s) => s.id === chatId)

  // The transcript: persisted messages, plus the in-flight turn while streaming.
  const pendingTurn = pending
  const selectedCount = selectedIds.size

  // Regenerate is additive (CONTEXT §4.6): a superseded answer stays in the DB but
  // its replacement takes its place in view. Hide any answer another one points at,
  // plus the one currently being regenerated as its fresh answer streams in.
  const superseded = new Set(
    messages.map((m) => m.regeneratedFrom).filter((id): id is string => !!id),
  )
  if (pendingTurn?.regeneratingFrom) superseded.add(pendingTurn.regeneratingFrom)
  const visibleMessages = messages.filter((m) => !superseded.has(m.id))

  // The newest assistant answer can be regenerated (only when idle).
  const lastAssistantId = [...visibleMessages]
    .reverse()
    .find((m) => m.role === "assistant")?.id

  // Sources panel shows the passages cited by the latest answer.
  const latestSources = latestCitations(visibleMessages)

  return (
    <div className="flex flex-1 overflow-hidden">
      <ChatHistorySidebar
        project={project}
        projectId={projectId}
        sessions={sessions}
        activeChatId={chatId}
      />

      {/* center column */}
      <div className="flex flex-1 flex-col overflow-hidden bg-secondary">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-7">
          <h1 className="truncate text-base font-bold tracking-tight">
            {activeSession?.title ?? "New chat"}
          </h1>
          <span className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-accent px-2.5 text-[12.5px] font-semibold text-accent-foreground">
            <FileText className="size-[13px]" strokeWidth={2.2} />
            {selectedCount} {selectedCount === 1 ? "document" : "documents"} in
            context
          </span>
        </header>

        <div className="flex-1 overflow-y-auto py-8">
          <div className="mx-auto flex max-w-[720px] flex-col gap-[30px] px-4">
            {visibleMessages.length === 0 && !pendingTurn && (
              <EmptyState hasDocuments={documents.some((d) => d.status === "indexed")} />
            )}
            {visibleMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onOpenSources={() => setTab("sources")}
                canRegenerate={
                  message.id === lastAssistantId && !isStreaming && !!chatId
                }
                onRegenerate={() =>
                  chatId &&
                  regenerate({
                    messageId: message.id,
                    model: answerModel.model,
                    sessionId: chatId,
                  })
                }
              />
            ))}
            {pendingTurn && (
              <>
                {pendingTurn.userContent !== undefined && (
                  <UserBubble text={pendingTurn.userContent} />
                )}
                <AssistantStreaming
                  text={pendingTurn.assistantText}
                  error={pendingTurn.error}
                />
              </>
            )}
          </div>
        </div>

        <Composer
          documents={documents}
          selectedIds={selectedIds}
          model={answerModel}
          streaming={isStreaming}
          onStop={stop}
          onSend={(content) =>
            send({
              content,
              model: answerModel.model,
              selectedDocumentIds: [...selectedIds],
              sessionId: chatId,
            })
          }
        />
      </div>

      <SidePanel
        tab={tab}
        onTabChange={setTab}
        documents={documents}
        selected={selectedIds}
        onToggleDoc={toggleDoc}
        sources={latestSources}
      />
    </div>
  )
}

/** Citations of the most recent assistant message (the "latest answer"). */
function latestCitations(messages: ChatMessage[]): Citation[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant") return m.citations
  }
  return []
}

// ── left: chat history ──────────────────────────────────────────────────────

function ChatHistorySidebar({
  project,
  projectId,
  sessions,
  activeChatId,
}: {
  project: Project
  projectId: string
  sessions: ChatSession[]
  activeChatId: string | undefined
}) {
  const navigate = useNavigate()
  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r bg-card">
      <ProjectSidebarHeader project={project} />

      <div className="p-3.5 pb-2.5">
        <Button
          variant="outline"
          onClick={() => navigate(`/p/${projectId}/chat`)}
          className="h-10 w-full rounded-[10px] font-semibold hover:border-primary hover:text-primary"
        >
          <Plus data-icon="inline-start" strokeWidth={2.3} />
          New chat
        </Button>
      </div>

      <p className="px-4 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        Recent
      </p>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4">
        {sessions.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No chats yet. Ask a question to start one.
          </p>
        )}
        {sessions.map((chat) => {
          const active = chat.id === activeChatId
          return (
            <Link
              key={chat.id}
              to={`/p/${projectId}/chat/${chat.id}`}
              className={cn(
                "rounded-[10px] border-l-[3px] px-3 py-2.5 transition-colors",
                active
                  ? "border-primary bg-accent"
                  : "border-transparent hover:bg-secondary"
              )}
            >
              <p
                className={cn(
                  "truncate text-[13.5px] font-semibold",
                  active ? "text-accent-foreground" : "text-foreground/80"
                )}
              >
                {chat.title}
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">{chat.updatedLabel}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </aside>
  )
}

// ── center: messages ────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] whitespace-pre-wrap rounded-[16px] rounded-br-[4px] bg-primary px-[17px] py-3 text-[14.5px] leading-relaxed text-primary-foreground">
        {text}
      </div>
    </div>
  )
}

function AssistantAvatar() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-rail text-[13px] font-extrabold text-white">
      A
    </div>
  )
}

function AssistantStreaming({
  text,
  error,
}: {
  text: string
  error?: string
}) {
  return (
    <div className="flex gap-3.5">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        {error ? (
          <p className="text-[14.5px] leading-[1.65] text-destructive">{error}</p>
        ) : text ? (
          <p className="whitespace-pre-wrap text-[14.5px] leading-[1.65] text-foreground/90">
            <InlineCitations text={text} />
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary align-middle" />
          </p>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-[13.5px]">Searching your documents…</span>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  onOpenSources,
  canRegenerate,
  onRegenerate,
}: {
  message: ChatMessage
  onOpenSources: () => void
  canRegenerate: boolean
  onRegenerate: () => void
}) {
  if (message.role === "user") return <UserBubble text={message.content} />

  return (
    <div className="flex gap-3.5">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-[14.5px] leading-[1.65] text-foreground/90">
          <InlineCitations text={message.content} onClick={onOpenSources} />
        </p>
        {message.status === "stopped" && (
          <p className="mt-2 text-xs italic text-muted-foreground">
            Generation stopped.
          </p>
        )}
        {canRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <RefreshCw className="size-3" strokeWidth={2.2} />
            Regenerate
          </button>
        )}
        {message.citations.length > 0 && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              Sources
            </span>
            {message.citations.map((cite) => (
              <button
                key={cite.n}
                type="button"
                onClick={onOpenSources}
                className="inline-flex h-[26px] max-w-[230px] items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs transition-colors hover:border-primary"
              >
                <CitationNumber n={cite.n} />
                <span className="truncate font-medium text-foreground/75">
                  {shortDocName(cite.documentName)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Renders assistant text, turning "[n]" markers into clickable superscripts. */
function InlineCitations({
  text,
  onClick,
}: {
  text: string
  onClick?: () => void
}) {
  const parts = text.split(/(\[\d+\])/g)
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\[(\d+)\]$/.exec(part)
        if (!match) return <span key={i}>{part}</span>
        return (
          <button
            key={i}
            type="button"
            onClick={onClick}
            className="mx-0.5 -translate-y-1 align-super text-[10px] font-bold text-primary hover:underline"
          >
            [{match[1]}]
          </button>
        )
      })}
    </>
  )
}

function CitationNumber({ n }: { n: number }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-accent text-[10px] font-bold text-accent-foreground">
      {n}
    </span>
  )
}

function EmptyState({ hasDocuments }: { hasDocuments: boolean }) {
  return (
    <div className="mt-16 flex flex-col items-center text-center text-muted-foreground">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <FileText className="size-6" strokeWidth={2} />
      </div>
      <p className="mt-4 text-[15px] font-semibold text-foreground">
        Ask a question about your documents
      </p>
      <p className="mt-1 max-w-[380px] text-[13.5px]">
        {hasDocuments
          ? "Select the documents to search, then ask below. Answers come with numbered citations back to the source."
          : "Upload and index a document first, then ask a question here."}
      </p>
    </div>
  )
}

// ── center: composer ────────────────────────────────────────────────────────

function Composer({
  documents,
  selectedIds,
  model: answerModel,
  streaming,
  onStop,
  onSend,
}: {
  documents: Document[]
  selectedIds: Set<string>
  model: ReturnType<typeof useAnswerModel>
  streaming: boolean
  onStop: () => void
  onSend: (content: string) => void
}) {
  const { model, models, pick, activeLabel } = answerModel

  const [input, setInput] = useState("")
  const selectedDocs = documents.filter((d) => selectedIds.has(d.id))
  const canSend = input.trim().length > 0 && selectedIds.size > 0 && !streaming

  function submit() {
    if (!canSend || !model) return
    onSend(input.trim())
    setInput("")
  }

  return (
    <div className="shrink-0 pb-6">
      <div className="mx-auto max-w-[720px] px-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs font-medium text-muted-foreground">
            {selectedDocs.length > 0 ? "Chatting with" : "Select documents to chat with"}
          </span>
          {selectedDocs.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border bg-card px-2 text-xs font-medium text-foreground/80"
            >
              <DocBadge type={doc.type} size="sm" />
              {shortDocName(doc.filename)}
            </span>
          ))}
        </div>

        <div className="rounded-2xl border bg-card p-4 shadow-[0_4px_16px_-8px_oklch(0.4_0.03_264_/_0.2)] focus-within:border-ring">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Ask a question about your selected documents…"
            rows={1}
            className="min-h-6 resize-none border-0 bg-transparent p-0 text-[14.5px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="mt-3 flex items-center justify-between">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-[30px] rounded-lg text-[12.5px] text-muted-foreground"
                  >
                    {activeLabel}
                    <ChevronDown data-icon="inline-end" className="opacity-70" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="min-w-[200px]">
                {models.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() => pick(m.id)}
                    className="justify-between"
                  >
                    {m.label}
                    {m.id === model && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {streaming ? (
              <Button
                size="icon"
                variant="outline"
                className="size-9 rounded-[10px]"
                onClick={onStop}
                aria-label="Stop generating"
              >
                <Square className="size-3.5 fill-current" strokeWidth={2.3} />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-9 rounded-[10px]"
                disabled={!canSend}
                onClick={submit}
                aria-label="Send message"
              >
                <ArrowUp strokeWidth={2.3} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── right: documents / sources panel ────────────────────────────────────────

function SidePanel({
  tab,
  onTabChange,
  documents,
  selected,
  onToggleDoc,
  sources,
}: {
  tab: "documents" | "sources"
  onTabChange: (t: "documents" | "sources") => void
  documents: Document[]
  selected: Set<string>
  onToggleDoc: (id: string) => void
  sources: Citation[]
}) {
  return (
    <aside className="flex w-[328px] shrink-0 flex-col border-l bg-card">
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as typeof tab)}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0 px-4 pt-3.5">
          <TabsTrigger value="documents" className={sidePanelTab}>
            Documents
          </TabsTrigger>
          <TabsTrigger value="sources" className={sidePanelTab}>
            Sources
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="documents"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <p className="px-4 pb-2 pt-3.5 text-xs text-muted-foreground">
            Select which documents to include in this chat's context. Only
            indexed documents can be searched.
          </p>
          <div className="flex-1 overflow-y-auto px-2.5 pb-4">
            {documents.length === 0 && (
              <p className="px-2 py-2 text-[13px] text-muted-foreground">
                No documents in this project yet.
              </p>
            )}
            {documents.map((doc) => {
              const indexed = doc.status === "indexed"
              const isSelected = selected.has(doc.id)
              return (
                <button
                  key={doc.id}
                  type="button"
                  disabled={!indexed}
                  onClick={() => onToggleDoc(doc.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[10px] p-2.5 text-left transition-colors",
                    indexed ? "hover:bg-secondary" : "cursor-not-allowed opacity-60"
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    disabled={!indexed}
                    className="pointer-events-none size-[19px]"
                    tabIndex={-1}
                  />
                  <DocBadge type={doc.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">
                      {doc.filename}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {indexed
                        ? `${doc.pageCount} pages · ${doc.sizeLabel}`
                        : doc.status === "processing"
                          ? "Processing…"
                          : "Failed to index"}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent
          value="sources"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <p className="px-4 pb-2 pt-3.5 text-xs text-muted-foreground">
            Passages retrieved for the latest answer.
          </p>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
            {sources.length === 0 && (
              <p className="px-1 py-2 text-[13px] text-muted-foreground">
                Sources for the latest answer will appear here.
              </p>
            )}
            {sources.map((source) => (
              <div key={source.n} className="overflow-hidden rounded-xl border">
                <div className="flex items-center gap-2.5 border-b bg-secondary px-3 py-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
                    {source.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold">
                      {source.documentName}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      p. {source.page} · chunk {source.chunkIndex}
                    </p>
                  </div>
                </div>
                <p className="border-l-[3px] border-border px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground/70">
                  {source.snippet}
                </p>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  )
}

/**
 * Side-panel tab: flat underline style. Neutralizes the default nova pill
 * (bg/shadow on active) and uses base-ui's `data-active` for a primary
 * border-bottom + foreground text, matching the prototype.
 */
const sidePanelTab = cn(
  "h-auto flex-none rounded-none border-b-2 border-transparent px-3 pb-3 text-[13.5px] font-semibold text-muted-foreground after:hidden",
  "data-active:border-b-primary data-active:bg-transparent data-active:text-foreground data-active:shadow-none"
)

function shortDocName(name: string) {
  return name.replace(/\.(pdf|docx)$/i, "")
}
