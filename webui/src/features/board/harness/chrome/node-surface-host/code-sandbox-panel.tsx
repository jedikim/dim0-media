import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CancelPlainIcon, ConsoleIcon, LoaderIcon, PlayIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { useCanvasStore, useNode } from "@canvas-harness/react"
import type { NodeId } from "@canvas-harness/core"
import { CodeArea } from "@/features/board/components/flow/code-area"
import { cn } from "@/lib/utils"
import type { CodeExecutionResult } from "@/features/board/api/execute-code-note"
import { executeCodeNote } from "@/features/board/api/execute-code-note"
import { updateNote } from "@/features/board/api/update-note"
import type { NoteNodeData } from "../../convert/note-to-node"
import { useBoardAppStore } from "../../store/board-app-store"


const EMPTY_CODE_EXECUTION_RESULT: CodeExecutionResult = {
  status: "success",
  stdout: "",
  stderr: "",
  durationMs: 0,
}


export type CodeSandboxPanelProps = {
  nodeId: string
  onClose: () => void
}


const PANEL_CLASS =
  "absolute left-1/2 -translate-x-1/2 top-4 bottom-4 md:top-20 md:bottom-[96px] w-[min(1100px,calc(100vw-2rem))] z-[55] flex flex-col rounded-lg border bg-background shadow-xl overflow-hidden"


/**
 * Floating Python sandbox editor — CodeArea bound to the node's
 * `content` via the canvas-harness store, plus an Execute action
 * that PATCHes the latest draft to the server then triggers the
 * existing executeCodeNote backend endpoint.
 */
export const CodeSandboxPanel = memo(function CodeSandboxPanel({
  nodeId,
  onClose,
}: CodeSandboxPanelProps) {
  const store = useCanvasStore()
  const node = useNode(nodeId as NodeId)
  const data = (node?.data ?? {}) as Partial<NoteNodeData>
  const boardId = useBoardAppStore((s) => s.boardId)

  const [codeDraft, setCodeDraft] = useState(node?.content ?? "")
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<CodeExecutionResult>(EMPTY_CODE_EXECUTION_RESULT)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(data.label?.markdown ?? "")
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setCodeDraft(node?.content ?? "")
  }, [node?.content, nodeId])

  useEffect(() => {
    if (titleEditing) return
    setTitleDraft(data.label?.markdown ?? "")
  }, [data.label?.markdown, titleEditing])

  useEffect(() => {
    if (!titleEditing) return
    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [titleEditing])

  const saveDraft = useCallback(
    (code: string) => {
      if (!node) return
      if (code === (node.content ?? "")) return
      store.updateNode(nodeId as NodeId, { content: code })
    },
    [node, nodeId, store],
  )

  // Debounced autosave through the harness op log.
  useEffect(() => {
    if (!node) return
    const timer = window.setTimeout(() => saveDraft(codeDraft), 250)
    return () => window.clearTimeout(timer)
  }, [codeDraft, node, saveDraft])

  const commitTitle = useCallback(
    (next: string) => {
      const trimmed = next.trim()
      const prev = data.label?.markdown?.trim() ?? ""
      if (trimmed === prev) return
      const prevData = (node?.data ?? {}) as Record<string, unknown>
      store.updateNode(nodeId as NodeId, {
        data: {
          ...prevData,
          label: trimmed ? { markdown: trimmed } : undefined,
        },
      })
    },
    [data.label?.markdown, node?.data, nodeId, store],
  )

  const stopTitleEdit = useCallback(
    (save: boolean) => {
      if (save) commitTitle(titleDraft)
      else setTitleDraft(data.label?.markdown ?? "")
      setTitleEditing(false)
    },
    [commitTitle, titleDraft, data.label?.markdown],
  )

  const handleExecute = useCallback(async () => {
    if (!boardId || isExecuting) return

    setIsExecuting(true)
    try {
      saveDraft(codeDraft)
      // PATCH the latest draft to the server so executeCodeNote runs
      // exactly what the user sees, even if the harness persist queue
      // hasn't flushed yet.
      await updateNote(boardId, nodeId, {
        content: { markdown: codeDraft },
        properties: {
          programmingLanguage: { type: "text", text: "python" },
        } as never,
      })

      const nextResult = await executeCodeNote(boardId, nodeId)
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
  }, [boardId, codeDraft, isExecuting, nodeId, saveDraft])

  const lastRunLabel = useMemo(
    () => (result.durationMs > 0 ? `Last run • ${result.durationMs} ms` : "Last run"),
    [result.durationMs],
  )

  if (!node) {
    return (
      <div className={`${PANEL_CLASS} items-center justify-center gap-3 text-sm text-muted-foreground`}>
        <p>This sandbox no longer exists.</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

  const displayTitle = data.label?.markdown?.trim() || "Untitled sandbox"

  return (
    <div className={PANEL_CLASS} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-border/70 bg-card px-4 py-3 text-foreground">
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
                className="w-full border-0 border-b border-current/30 bg-transparent px-0 py-0.5 text-sm font-semibold text-foreground focus:border-secondary-foreground focus:outline-none"
                placeholder="Untitled sandbox"
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
          <span className="text-xs font-medium text-muted-foreground">
            Python
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Max runtime 60s
          </span>
          <Button
            type="button"
            size="sm"
            onClick={handleExecute}
            disabled={isExecuting || !boardId}
            className="gap-2"
          >
            {isExecuting ? (
              <LoaderIcon className="size-4 shrink-0 animate-spin" strokeWidth={2} />
            ) : (
              <PlayIcon className="size-4 shrink-0" strokeWidth={2} />
            )}
            {isExecuting ? "Running" : "Execute"}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="text-foreground"
          >
            <CancelPlainIcon className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1.3fr_0.9fr]">
        <div className="min-h-0 border-r border-border/70 bg-card">
          <CodeArea
            value={codeDraft}
            onChange={setCodeDraft}
          />
        </div>

        <div className="grid min-h-0 grid-rows-[auto_1fr_1fr] bg-card">
          <div className="px-4 py-3 text-xs font-medium text-muted-foreground">
            {lastRunLabel}
          </div>

          <div className="min-h-0 border-t border-border/70">
            <div className="px-4 py-2 text-xs font-semibold text-primary">
              stdout
            </div>
            <pre className="scrollbar-thin h-full overflow-auto overflow-x-auto whitespace-pre-wrap break-all px-4 pb-4 font-mono text-xs leading-5 text-foreground">
              {result.stdout || "No stdout"}
            </pre>
          </div>

          <div className="min-h-0 border-t border-border/70">
            <div className="px-4 py-2 text-xs font-semibold text-destructive">
              stderr
            </div>
            <pre
              className={cn(
                "scrollbar-thin h-full overflow-auto overflow-x-auto whitespace-pre-wrap break-all px-4 pb-4 font-mono text-xs leading-5",
                result.stderr ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {result.stderr || "No stderr"}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
})
