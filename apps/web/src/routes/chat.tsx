import { useMemo, useState } from "react"
import { ArrowUp, FileText, Paperclip, Plus, X } from "lucide-react"
import { Link, Navigate, useParams } from "react-router-dom"

import { DocBadge } from "@/components/doc-badge"
import { ProjectSidebarHeader } from "@/components/project-sidebar-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  defaultSelectedDocIds,
  getChats,
  getDocuments,
  getMessages,
  getProject,
  type Chat,
  type Citation,
  type Doc,
  type Message,
} from "@/lib/mock-data"
import { cn } from "@/lib/utils"

export function ChatScreen() {
  const { projectId = "", chatId } = useParams()
  const project = getProject(projectId)
  const chats = getChats(projectId)
  const activeChatId = chatId ?? chats[0]?.id ?? ""

  const documents = getDocuments(projectId)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSelectedDocIds)
  )
  const [tab, setTab] = useState<"documents" | "sources">("documents")

  const messages = getMessages(activeChatId)
  const activeChat = chats.find((c) => c.id === activeChatId)
  const sources = useMemo(
    () =>
      messages.flatMap((m) => (m.role === "assistant" ? m.citations : [])),
    [messages]
  )

  if (!project) return <Navigate to="/" replace />

  function toggleDoc(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedDocs = documents.filter((d) => selected.has(d.id))

  return (
    <div className="flex flex-1 overflow-hidden">
      <ChatHistorySidebar
        project={project}
        projectId={projectId}
        chats={chats}
        activeChatId={activeChatId}
      />

      {/* center column */}
      <div className="flex flex-1 flex-col overflow-hidden bg-secondary">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-7">
          <h1 className="text-base font-bold tracking-tight">
            {activeChat?.title ?? "New chat"}
          </h1>
          <span className="flex h-7 items-center gap-1.5 rounded-full bg-accent px-2.5 text-[12.5px] font-semibold text-accent-foreground">
            <FileText className="size-[13px]" strokeWidth={2.2} />
            {selectedDocs.length} documents in context
          </span>
        </header>

        <div className="flex-1 overflow-y-auto py-8">
          <div className="mx-auto flex max-w-[720px] flex-col gap-[30px] px-4">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onOpenSources={() => setTab("sources")}
              />
            ))}
          </div>
        </div>

        <Composer
          selectedDocs={selectedDocs}
          onRemoveDoc={toggleDoc}
        />
      </div>

      <SidePanel
        tab={tab}
        onTabChange={setTab}
        documents={documents}
        selected={selected}
        onToggleDoc={toggleDoc}
        sources={sources}
      />
    </div>
  )
}

// ── left: chat history ──────────────────────────────────────────────────────

function ChatHistorySidebar({
  project,
  projectId,
  chats,
  activeChatId,
}: {
  project: NonNullable<ReturnType<typeof getProject>>
  projectId: string
  chats: Chat[]
  activeChatId: string
}) {
  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r bg-card">
      <ProjectSidebarHeader project={project} />

      <div className="p-3.5 pb-2.5">
        <Button
          variant="outline"
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
        {chats.map((chat) => {
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
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {chat.preview}
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">{chat.timeLabel}</span>
                <span>· {chat.docCount} docs</span>
              </div>
            </Link>
          )
        })}
      </div>
    </aside>
  )
}

// ── center: messages ────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onOpenSources,
}: {
  message: Message
  onOpenSources: () => void
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-[16px] rounded-br-[4px] bg-primary px-[17px] py-3 text-[14.5px] leading-relaxed text-primary-foreground">
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-rail text-[13px] font-extrabold text-white">
        R
      </div>
      <div className="min-w-0 flex-1">
        {message.paragraphs.map((para, i) => (
          <p
            key={i}
            className="mb-3 text-[14.5px] leading-[1.65] text-foreground/90"
          >
            <InlineCitations text={para} onClick={onOpenSources} />
          </p>
        ))}
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
                  {shortDocName(cite.docName)}
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
  onClick: () => void
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
            className="mx-0.5 -translate-y-1 text-[10px] align-super font-bold text-primary hover:underline"
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

// ── center: composer ────────────────────────────────────────────────────────

function Composer({
  selectedDocs,
  onRemoveDoc,
}: {
  selectedDocs: Doc[]
  onRemoveDoc: (id: string) => void
}) {
  return (
    <div className="shrink-0 pb-6">
      <div className="mx-auto max-w-[720px] px-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs font-medium text-muted-foreground">
            Chatting with
          </span>
          {selectedDocs.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border bg-card pl-2 pr-1.5 text-xs font-medium text-foreground/80"
            >
              <DocBadge type={doc.type} size="sm" />
              {doc.short}
              <button
                type="button"
                aria-label={`Remove ${doc.short}`}
                onClick={() => onRemoveDoc(doc.id)}
                className="flex p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>

        <div className="rounded-2xl border bg-card p-4 shadow-[0_4px_16px_-8px_oklch(0.4_0.03_264_/_0.2)] focus-within:border-ring">
          <Textarea
            placeholder="Ask a question about your selected documents…"
            rows={1}
            className="min-h-6 resize-none border-0 bg-transparent p-0 text-[14.5px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="mt-3 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              className="h-[30px] rounded-lg text-[12.5px] text-muted-foreground"
            >
              <Paperclip data-icon="inline-start" />
              Attach
            </Button>
            <Button size="icon" className="size-9 rounded-[10px]">
              <ArrowUp strokeWidth={2.3} />
            </Button>
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
  documents: Doc[]
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
            Select which documents to include in this chat's context.
          </p>
          <div className="flex-1 overflow-y-auto px-2.5 pb-4">
            {documents.map((doc) => {
              const isSelected = selected.has(doc.id)
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onToggleDoc(doc.id)}
                  className="flex w-full items-center gap-3 rounded-[10px] p-2.5 text-left transition-colors hover:bg-secondary"
                >
                  <Checkbox
                    checked={isSelected}
                    className="pointer-events-none size-[19px]"
                    tabIndex={-1}
                  />
                  <DocBadge type={doc.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">
                      {doc.name}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {doc.pages} pages · {doc.sizeLabel}
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
            {sources.map((source) => (
              <div
                key={source.n}
                className="overflow-hidden rounded-xl border"
              >
                <div className="flex items-center gap-2.5 border-b bg-secondary px-3 py-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
                    {source.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold">
                      {source.docName}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {source.locationLabel}
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
