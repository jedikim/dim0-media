import { memo, useCallback, useEffect, useRef, useState } from "react"

import { CancelPlainIcon, DownloadIcon, LayoutIcon, SparklesIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "@/components/theme-provider"

import { useGraphStore } from "../../store/graph-store"
import { CodeArea } from "./code-area"
import { WidgetIframe } from "./widget-iframe"
import { buildWidgetDocument } from "./widget-document"


type WidgetPanelProps = {
  nodeId: string
}


const PANEL_CLASS =
  "absolute left-1/2 -translate-x-1/2 top-4 bottom-4 md:top-20 md:bottom-[96px] w-[min(960px,calc(100vw-2rem))] z-[55] flex flex-col rounded-lg border bg-background shadow-xl overflow-hidden"


/**
 * Inline panel for previewing and editing widget HTML in one place.
 */
export const WidgetPanel = memo(function WidgetPanel({
  nodeId,
}: WidgetPanelProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const note = useGraphStore((state) => state.nodesById.get(nodeId)?.data)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)
  const closeNodeSurface = useGraphStore((state) => state.closeNodeSurface)
  const setChatSheetOpen = useGraphStore((state) => state.setChatSheetOpen)
  const [activeTab, setActiveTab] = useState("rendered")
  const [htmlDraft, setHtmlDraft] = useState(note?.content?.markdown || "")
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(note?.label?.markdown || "")
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setHtmlDraft(note?.content?.markdown || "")
  }, [note?.content?.markdown, nodeId])

  useEffect(() => {
    if (titleEditing) return
    setTitleDraft(note?.label?.markdown || "")
  }, [note?.label?.markdown, titleEditing])

  useEffect(() => {
    if (!titleEditing) return
    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [titleEditing])

  useEffect(() => {
    if (!note) return

    const timer = window.setTimeout(() => {
      updateNodeByIdPersist(note.id, (node) => ({
        ...node,
        data: {
          ...node.data,
          content: { markdown: htmlDraft },
        },
      }))
    }, 250)

    return () => window.clearTimeout(timer)
  }, [htmlDraft, note, updateNodeByIdPersist])

  // Close on Escape — but skip when focus is in an editor/input or while
  // editing the title (Escape there cancels the rename).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (titleEditing) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return
      }
      closeNodeSurface()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [closeNodeSurface, titleEditing])

  /**
   * Persist the edited widget title back into the node label.
   */
  const commitTitle = useCallback((nextRaw: string) => {
    if (!note) return

    const next = nextRaw.trim()
    const prev = note.label?.markdown?.trim() || ""
    if (next === prev) return

    updateNodeByIdPersist(note.id, (node) => ({
      ...node,
      data: {
        ...node.data,
        label: next ? { markdown: next } : undefined,
      },
    }))
  }, [note, updateNodeByIdPersist])

  /**
   * End title editing, optionally saving the current draft.
   */
  const stopTitleEdit = useCallback((save: boolean) => {
    if (save) commitTitle(titleDraft)
    else setTitleDraft(note?.label?.markdown || "")
    setTitleEditing(false)
  }, [commitTitle, note?.label?.markdown, titleDraft])

  /**
   * Download the current widget HTML as a local .html file.
   */
  const handleDownloadHtml = useCallback(() => {
    const html = htmlDraft
    if (!html.trim()) return

    const safeBaseName = (note?.label?.markdown || "widget")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "widget"

    const fullHtml = buildWidgetDocument(html, note?.label?.markdown || "Widget")
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${safeBaseName}.html`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [htmlDraft, note?.label?.markdown])

  if (!note) return null

  const html = htmlDraft.trim()
  const displayTitle = note.label?.markdown?.trim() || "Untitled widget"

  return (
    <div className={PANEL_CLASS}>
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
          <LayoutIcon className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            {titleEditing ? (
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => stopTitleEdit(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    stopTitleEdit(true)
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    stopTitleEdit(false)
                  }
                }}
                className="w-full bg-transparent text-sm font-semibold text-foreground border-0 border-b border-foreground/30 focus:border-secondary-foreground focus:outline-none px-0 py-0.5"
                placeholder="Untitled widget"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTitleEditing(true)}
                className="block max-w-full truncate text-left text-sm font-semibold text-foreground hover:underline"
                title={displayTitle}
              >
                {displayTitle}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Mobile-only AI affordance — see sheet-node-panel for the
              rationale: floating island is hidden under a panel on mobile. */}
          <button
            type="button"
            onClick={() => setChatSheetOpen(true)}
            title="Open AI chat"
            aria-label="Open AI chat"
            className="md:hidden flex items-center justify-center rounded-md bg-gradient-to-br from-wiki-link to-secondary-foreground size-7 shrink-0 shadow-sm transition hover:brightness-110"
          >
            <SparklesIcon className="size-3.5 text-primary-foreground" weight="fill" />
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDownloadHtml}
            title="Download HTML"
            aria-label="Download HTML"
            disabled={!html}
          >
            <DownloadIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => closeNodeSurface()} title="Close" aria-label="Close">
            <CancelPlainIcon className="size-4" />
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 gap-0">
        <div className="border-b border-border/70 px-4 py-2">
          <TabsList>
            <TabsTrigger value="rendered">Rendered</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
          </TabsList>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            className={activeTab === "rendered" ? "flex h-full flex-col" : "hidden h-full"}
          >
            {html ? (
              <WidgetIframe
                html={html}
                title="Widget"
                className="h-full w-full border-0 bg-transparent"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Widget HTML is empty.
              </div>
            )}
          </div>

          <div
            className={activeTab === "code" ? "flex h-full flex-col bg-background" : "hidden h-full"}
          >
            <CodeArea
              value={htmlDraft}
              isDark={isDark}
              textColor="var(--foreground)"
              onChange={setHtmlDraft}
              language="html"
              placeholder={`<section style="padding:24px;">
  <h1>Hello widget</h1>
  <p>Use var(--card), var(--foreground), var(--border), var(--radius), and var(--shadow-sm).</p>
</section>`}
            />
          </div>
        </div>
      </Tabs>
    </div>
  )
})
