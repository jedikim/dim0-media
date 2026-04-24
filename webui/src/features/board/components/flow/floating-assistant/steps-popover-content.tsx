import { PopoverContent } from "@/components/ui/popover"
import { SparklesIcon } from "@/components/icons"
import type { ToolCallStep } from "@/features/agent/types/stream"
import { StepsPopoverRow } from "./steps-popover-row"


/**
 * Content shell of the Steps popover. Renders a mono-cased header with a count
 * plus the ordered list of tool steps. Designed to be anchored above the
 * island's progress strip via the parent Popover.
 */
export const StepsPopoverContent = ({ toolSteps }: { toolSteps: ToolCallStep[] }) => {
  return (
    <PopoverContent
      side='top'
      align='end'
      sideOffset={8}
      className={
        "w-[min(580px,calc(100vw-4rem))] max-h-[50vh] overflow-y-auto scrollbar-thin " +
        "bg-sidebar border border-border rounded-2xl " +
        "shadow-[0_6px_16px_-4px_rgba(0,0,0,0.18),0_1px_4px_-2px_rgba(0,0,0,0.08)] " +
        "dark:shadow-[0_8px_20px_-4px_rgba(0,0,0,0.4),0_1px_4px_-2px_rgba(0,0,0,0.2)] " +
        "p-3"
      }
    >
      <div className='flex items-center justify-between mb-2 px-0.5'>
        <div className='flex items-center gap-1.5 text-xs font-mono font-medium text-muted-foreground'>
          <SparklesIcon className='size-3.5 text-secondary-foreground' weight='fill' />
          <span>Steps in this turn</span>
        </div>
        <span className='text-xs font-mono text-secondary-foreground tabular-nums'>
          {toolSteps.length}
        </span>
      </div>
      <div className='flex flex-col gap-1.5'>
        {toolSteps.map((step, i) => (
          <StepsPopoverRow key={step.id} step={step} index={i} />
        ))}
      </div>
    </PopoverContent>
  )
}
