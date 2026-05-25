import { type ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"


export type ToolbarAction = {
  id: string
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}


export type NodeToolbarProps = {
  actions: ReadonlyArray<ToolbarAction>
  className?: string
}


/**
 * Compact icon-button row for node-level actions (open surface,
 * duplicate, delete, lock, ...). Custom-node views assemble their own
 * action list and pass it in. Renders nothing when `actions` is empty.
 */
export function NodeToolbar({ actions, className }: NodeToolbarProps) {
  if (actions.length === 0) return null

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {actions.map((action) => (
        <Tooltip key={action.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              aria-label={action.label}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                action.destructive && "hover:text-destructive",
                action.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
              )}
            >
              {action.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{action.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
