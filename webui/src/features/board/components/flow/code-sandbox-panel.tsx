import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ConsoleIcon, LoaderIcon, PlayIcon, CancelPlainIcon, SparklesIcon } from "@/components/icons"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"

import { executeCodeNote, type CodeExecutionResult } from "../../api/execute-code-note"
import { updateNote } from "../../api/update-note"
import { useGraphStore } from "../../store/graph-store"
import type { Note } from "../../types/note"
import { CodeArea } from "./code-area"
import {
  EMPTY_CODE_EXECUTION_RESULT,
  ROSE_PINE_DARK,
  ROSE_PINE_LIGHT,
} from "./code-sandbox-utils"


type CodeSandboxPanelProps = {
  nodeId: string
}


const PANEL_CLASS =
  "absolute left-1/2 -translate-x-1/2 top-4 bottom-4 md:top-20 md:bottom-[96px] w-[min(1100px,calc(100vw-2rem))] z-[55] flex flex-col rounded-lg border bg-background shadow-xl overflow-hidden"


/**
 * Inline panel for editing and running a Python code sandbox node.
 */
export const CodeSandboxPanel = memo(function CodeSandboxPanel({
  nodeId,
}: CodeSandboxPanelProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const palette = isDark ? ROSE_PINE_DARK : ROSE_PINE_LIGHT

  const note = useGraphStore((state) => state.nodesById.get(nodeId)?.data)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)
  const closeNodeSurface = useGraphStore((state) => state.closeNodeSurface)
  const setChatSheetOpen = useGraphStore((state) => state.setChatSheetOpen)

  const [codeDraft, setCodeDraft] = useState(note?.content?.markdown || "")
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<CodeExecutionResult>(EMPTY_CODE_EXECUTION_RESULT)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(note?.label?.markdown || "")
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setCodeDraft(note?.content?.markdown || "")
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

  const saveDraft = useCallback((code: string) => {
    if (!note) return

    updateNodeByIdPersist(note.id, (node) => ({
      ...node,
      data: {
        ...node.data,
        content: { markdown: code },
        properties: {
          ...node.data.properties,
          programmingLanguage: { type: "text", text: "python" },
        },
      },
    }))
  }, [note, updateNodeByIdPersist])

  useEffect(() => {
    if (!note) return

    const timer = window.setTimeout(() => {
      saveDraft(codeDraft)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [codeDraft, note, saveDraft])

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
   * Persist the edited sandbox title back into the node label.
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

  const handleExecute = useCallback(async () => {
    if (!note?.graphUid || isExecuting) return

    setIsExecuting(true)
    try {
      saveDraft(codeDraft)

      await updateNote(note.graphUid, note.id, {
        content: { markdown: codeDraft },
        properties: {
          programmingLanguage: { type: "text", text: "python" },
        } as Note["properties"],
      })

      const nextResult = await executeCodeNote(note.graphUid, note.id)
      setResult(nextResult)
    } catch (error) {
      setResult({
        status: "error",
        stdout: "",
        stderr: error instanceof Error ? error.message : "Execution failed.",
        durationMs: 0,
      })
    } finally {
      setIsExecuting(false)
    }
  }, [codeDraft, isExecuting, note, saveDraft])

  const lastRunLabel = useMemo(
    () => (result.durationMs > 0 ? `Last run • ${result.durationMs} ms` : "Last run"),
    [result.durationMs],
  )

  if (!note) return null

  const displayTitle = note.label?.markdown?.trim() || "Untitled sandbox"

  return (
    <div className={PANEL_CLASS}>
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border/70"
        style={{
          backgroundColor: palette.panel,
          color: palette.text,
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
          <ConsoleIcon className="size-4 shrink-0" strokeWidth={2} />
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
                className="w-full bg-transparent text-sm font-semibold border-0 border-b border-current/30 focus:border-secondary-foreground focus:outline-none px-0 py-0.5"
                style={{ color: palette.text }}
                placeholder="Untitled sandbox"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTitleEditing(true)}
                className="block max-w-full truncate text-left text-sm font-semibold hover:underline"
                style={{ color: palette.text }}
                title={displayTitle}
              >
                {displayTitle}
              </button>
            )}
          </div>
          <span className="text-xs font-medium" style={{ color: palette.muted }}>
            Python
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: palette.muted }}>
            Max runtime 60s
          </span>
          <Button type="button" size="sm" onClick={handleExecute} disabled={isExecuting} className="gap-2">
            {isExecuting ? (
              <LoaderIcon className="size-4 shrink-0 animate-spin" strokeWidth={2} />
            ) : (
              <PlayIcon className="size-4 shrink-0" strokeWidth={2} />
            )}
            {isExecuting ? "Running" : "Execute"}
          </Button>
          {/* Mobile-only AI affordance — see sheet-node-panel for the rationale. */}
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
            onClick={() => closeNodeSurface()}
            title="Close"
            aria-label="Close"
            style={{ color: palette.text }}
          >
            <CancelPlainIcon className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid flex-1 min-h-0 lg:grid-cols-[1.3fr_0.9fr]">
        <div className="min-h-0" style={{ backgroundColor: palette.bg }}>
          <CodeArea
            value={codeDraft}
            isDark={isDark}
            textColor={palette.text}
            onChange={setCodeDraft}
          />
        </div>

        <div className="grid min-h-0 grid-rows-[auto_1fr_1fr]" style={{ backgroundColor: palette.panel }}>
          <div className="px-4 py-3 text-xs font-medium" style={{ color: palette.muted }}>
            {lastRunLabel}
          </div>

          <div className="min-h-0 border-t border-border/70">
            <div className="px-4 py-2 text-xs font-semibold" style={{ color: palette.accent }}>
              stdout
            </div>
            <pre
              className="h-full overflow-auto overflow-x-auto scrollbar-thin px-4 pb-4 whitespace-pre-wrap break-all font-mono text-xs leading-5"
              style={{ color: palette.text }}
            >
              {result.stdout || "No stdout"}
            </pre>
          </div>

          <div className="min-h-0 border-t border-border/70">
            <div className="px-4 py-2 text-xs font-semibold" style={{ color: palette.danger }}>
              stderr
            </div>
            <pre
              className="h-full overflow-auto overflow-x-auto scrollbar-thin px-4 pb-4 whitespace-pre-wrap break-all font-mono text-xs leading-5"
              style={{ color: result.stderr ? palette.danger : palette.muted }}
            >
              {result.stderr || "No stderr"}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
})
