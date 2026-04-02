import { HugeiconsIcon } from '@hugeicons/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { STARTER_PROMPTS } from './starter-prompts.data'


type StarterPromptPillsProps = {
  disabled?: boolean
  onSelect: (prompt: string) => void
}


/**
 * Render starter prompt pills for first-time chat users.
 */
export function StarterPromptPills({
  disabled = false,
  onSelect,
}: StarterPromptPillsProps) {
  return (
    <div className='flex w-full max-w-[800px] flex-wrap items-center justify-center gap-2'>
      {STARTER_PROMPTS.map((starterPrompt) => (
        <Tooltip key={starterPrompt.id}>
          <TooltipTrigger asChild>
            <button
              type='button'
              onClick={() => onSelect(starterPrompt.prompt)}
              disabled={disabled}
              className='inline-flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-sm text-card-foreground/75 transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-60'
            >
              <HugeiconsIcon icon={starterPrompt.icon} className='size-4 shrink-0 text-card-foreground/65' strokeWidth={1.8} />
              <span>{starterPrompt.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='bottom' sideOffset={8} className='max-w-56'>
            {starterPrompt.description}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
