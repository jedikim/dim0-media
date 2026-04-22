import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ResearchIcon } from "@/components/icons"
import { useChatStore } from "@/features/agent/store/chat-store"
import { clsx } from "clsx"

// Component that allows users to enable or disable the deep research tool
export const DeepResearchChoiceMenu = () => {
  const useDeepResearch = useChatStore((state) => state.useDeepResearch)
  const setUseDeepResearch = useChatStore((state) => state.setUseDeepResearch)

  const handleToggle = () => {
    setUseDeepResearch(!useDeepResearch)
  }

  const tooltipText = useDeepResearch ? "Disable Deep Research" : "Enable Deep Research - Finds and organizes in-depth information to help you understand any subject."

  const buttonClass = clsx(
    "transition-all shrink-0 my-icon p-2 rounded-md hover:bg-accent dark:bg-input/30 dark:hover:bg-accent/50 text-xs flex flex-row items-center gap-2 border border-transparent hover:border-border transition-colors",
    useDeepResearch ? '!text-secondary-foreground' : 'text-muted-foreground'
  )

  return (
    <Tooltip delayDuration={400}>
      <div className="rounded-md bg-background backdrop-blur-md supports-[backdrop-filter]:bg-sidebar/50">
        <TooltipTrigger asChild>
          <button
            className={buttonClass}
            onClick={handleToggle}
          >
            <ResearchIcon className='size-4 shrink-0' strokeWidth={2} />
            <span className='sr-only'>Deep Research</span>
          </button>
        </TooltipTrigger>
      </div>
      <TooltipContent>
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}
