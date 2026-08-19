import { useState } from "react"
import { MemorySearchIcon } from "@/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { getLocalStores } from "@/features/local-stores"
import type { MemoryRecord } from "@/features/board/persist/local/idb"


/** A read-only section (board or global) of the memory viewer. */
const MemoryGroup = ({ label, records }: { label: string; records: MemoryRecord[] }) => {
  if (records.length === 0) return null
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 select-none font-mono text-xs uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <ul className="flex flex-col gap-1.5">
        {records.map((r) => (
          <li key={r.id} className="rounded-md border border-border/60 bg-card/50 px-2 py-1.5">
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{r.kind}</span>
              <span className="truncate text-sm font-medium text-card-foreground">{r.title}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{r.summary}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}


/**
 * A subtle indicator + read-only viewer for the agent's durable memory (board ∪
 * global). Opens a popover listing what the agent has saved for this board. v1 is
 * read-only; editing/deletion happens through the agent (or a later full panel).
 */
export const MemoryButton = ({ boardId }: { boardId: string }) => {
  const [board, setBoard] = useState<MemoryRecord[]>([])
  const [global, setGlobal] = useState<MemoryRecord[]>([])
  const [loaded, setLoaded] = useState(false)


  const load = async () => {
    const { memories } = await getLocalStores()
    const [b, g] = await Promise.all([memories.list("board", boardId), memories.list("global", null)])
    setBoard(b)
    setGlobal(g)
    setLoaded(true)
  }


  const total = board.length + global.length
  return (
    <Popover onOpenChange={(open) => open && void load()}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Agent memory"
          aria-label="Agent memory"
          className={cn(
            "shrink-0 rounded-lg border border-transparent p-1.5 text-muted-foreground transition-colors",
            "hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-foreground/30",
          )}
        >
          <MemorySearchIcon className="size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[60vh] w-80 overflow-y-auto scrollbar-thin">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Memory</span>
          {loaded && <span className="font-mono text-xs text-muted-foreground/70">{total}</span>}
        </div>
        {loaded && total === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing saved yet. The agent remembers durable facts here as you work — stable preferences, decisions, and what
            this board is about.
          </p>
        ) : (
          <>
            <MemoryGroup label="This board" records={board} />
            <MemoryGroup label="Global" records={global} />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
