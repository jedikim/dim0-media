import { useMemo, useState } from "react"
import { useSearch } from "@tanstack/react-router"
import { ChevronDownIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { MiniLinkCard } from "@/features/agent/components/link-preview"
import { useChat } from "@/features/agent/hooks/chat-context"
import { CodeInterpreterResult, NoteToolResult, ToolArgsRows } from "@/features/agent/components/chat/tool-step-row"
import type { ToolCallStep } from "@/features/agent/types/stream"
import { ToolNameIcon } from "@/features/agent/types/stream"
import type {
  CodeInterpreterOutput,
  CreateNoteOutput,
  EditNoteOutput,
  WriteNoteOutput,
} from "@/features/agent/types/tool-outputs"
import { extractStepDescription, getToolTitle, getWebSearchUrls } from "@/features/agent/utils/stream/build"
import { BoardUrl } from "@/routes"


/**
 * Computes the first meaningful "key · value" preview for a tool step so the
 * collapsed row in the popover tells the user at a glance what the call was
 * about. Returns an empty string when no useful summary is available.
 */
const buildArgPreview = (step: ToolCallStep, inputString: string | undefined): string => {
  if (inputString) return inputString.split("\n")[0] ?? ""
  const args = step.arguments?.input
  if (!args || typeof args !== "object") return ""
  const entries = Object.entries(args as Record<string, unknown>).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  )
  if (entries.length === 0) return ""
  const [k, v] = entries[0]
  const value = typeof v === "string" ? v : JSON.stringify(v)
  return `${k} · ${value}`
}


/**
 * Compact expandable row rendered inside the Steps popover. The collapsed
 * header shows [order] + tool icon + tool title + arg preview + chevron; the
 * expanded body reuses the same arg rows, stdout/stderr, note card, and
 * source links as the sidebar tool step card.
 */
export const StepsPopoverRow = ({ step, index }: { step: ToolCallStep; index: number }) => {
  const [expanded, setExpanded] = useState(false)
  const { chatId } = useChat()
  const { rootId } = useSearch({
    from: BoardUrl,
    select: (s: { root_id?: string }) => ({ rootId: s.root_id }),
    shouldThrow: false,
  }) ?? {}

  const Icon = ToolNameIcon[step.name]
  const title = getToolTitle(step.name)
  const { input } = extractStepDescription(step)
  const sources = useMemo(() => getWebSearchUrls(step), [step])
  const argPreview = useMemo(() => buildArgPreview(step, input), [step, input])

  const rawArgs = step.arguments?.input
  const hasArgs = rawArgs !== undefined && rawArgs !== null && rawArgs !== ""
  const codeInterpreterOutput =
    step.name === "code_interpreter" && typeof step.output !== "string"
      ? (step.output as CodeInterpreterOutput)
      : null
  const noteToolOutput =
    (step.name === "write_note" || step.name === "create_note" || step.name === "edit_note") &&
    typeof step.output !== "string"
      ? (step.output as WriteNoteOutput | CreateNoteOutput | EditNoteOutput)
      : null

  const canExpand =
    hasArgs || !!input || !!codeInterpreterOutput || !!noteToolOutput || sources.length > 0

  return (
    <div className='flex flex-col rounded-md overflow-hidden border border-sidebar-border/60'>
      <button
        type='button'
        className={cn(
          "flex flex-row items-center gap-2 px-2 py-1.5 text-left",
          "bg-gradient-to-r from-secondary/20 via-muted to-muted",
          "hover:from-secondary/30 transition-colors",
          !canExpand && "cursor-default"
        )}
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        aria-expanded={expanded}
      >
        <span className='shrink-0 text-xs font-mono text-secondary-foreground tabular-nums select-none'>
          {index + 1}
        </span>
        <Icon className='size-3.5 shrink-0 text-secondary-foreground' strokeWidth={2} />
        <span className='shrink-0 text-xs font-mono font-medium text-foreground'>{title}</span>
        {argPreview && (
          <span className='flex-1 min-w-0 truncate text-xs font-mono text-muted-foreground' title={argPreview}>
            · {argPreview}
          </span>
        )}
        {!argPreview && <span className='flex-1' />}
        {canExpand && (
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180"
            )}
            strokeWidth={2}
          />
        )}
      </button>
      {expanded && canExpand && (
        <div className='flex flex-col gap-2 px-2 py-2 bg-sidebar w-full min-w-0'>
          {step.name !== "code_interpreter" && (
            <ToolArgsRows args={rawArgs} stepName={step.name} />
          )}
          {input && step.name === "code_interpreter" && (
            <pre className='w-full rounded-md border border-sidebar-border bg-background/60 p-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-left'>
              {input}
            </pre>
          )}
          {codeInterpreterOutput && <CodeInterpreterResult output={codeInterpreterOutput} />}
          {noteToolOutput && (
            <NoteToolResult output={noteToolOutput} chatId={chatId} rootId={rootId} />
          )}
          {sources.length > 0 && (
            <div className='w-full flex flex-row flex-wrap items-start gap-1 mt-1'>
              {sources.map((source, idx) => (
                <MiniLinkCard key={idx} annotation={source} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
