import { memo, useCallback, useEffect, useRef, useState } from "react"

import { CancelPlainIcon, DownloadIcon, LayoutIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "@/components/theme-provider"

import { useGraphStore } from "../../store/graph-store"
import { CodeArea } from "./code-area"
import { WidgetIframe } from "./widget-iframe"
import { buildWidgetDocument } from "./widget-document"


type WidgetDialogProps = {
  nodeId: string
}


/**
 * Dialog for previewing and editing widget HTML in one place.
 */
export const WidgetDialog = memo(function WidgetDialog({
  nodeId,
}: WidgetDialogProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const note = useGraphStore((state) => state.nodesById.get(nodeId)?.data)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)
  const closeNodeSurface = useGraphStore((state) => state.closeNodeSurface)
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

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      closeNodeSurface()
    }
  }, [closeNodeSurface])

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
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-5xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Widget</DialogTitle>
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
            <Button variant="ghost" size="icon-sm" onClick={() => handleOpenChange(false)} title="Close" aria-label="Close">
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
      </DialogContent>
    </Dialog>
  )
})
