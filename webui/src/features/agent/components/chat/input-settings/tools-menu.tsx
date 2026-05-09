import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToolsMenuIcon } from "@/components/icons"
import { clsx } from "clsx"
import { CodeInterpreterChoiceMenu } from "./code-interpreter"
import { ImageGenMenu } from "./image-gen"
import { MemorySearchChoiceMenu } from "./memory-search"
import { ModelChoiceMenu } from "./model-card"
import { SearchEngineChoiceMenu } from "./web-search"

type ToolsMenuProps = {
  memorySearchAvailable?: boolean
}

export const ToolsMenu = ({ memorySearchAvailable = true }: ToolsMenuProps) => {
  const buttonClass = clsx(
    "transition-all shrink-0 my-icon p-2 rounded-lg",
    "hover:bg-accent dark:bg-input/30 dark:hover:bg-accent/50",
    "border border-transparent hover:border-border transition-colors",
    "text-muted-foreground"
  )

  return (
    <Dialog>
      <Tooltip delayDuration={400}>
        <div className="rounded-lg bg-background backdrop-blur-md supports-[backdrop-filter]:bg-sidebar/50">
          <TooltipTrigger asChild>
            <DialogTrigger
              render={
                <button
                  className={buttonClass}
                  aria-label="Open settings"
                >
                  <ToolsMenuIcon className="size-4 shrink-0" strokeWidth={2} />
                </button>
              }
            />
          </TooltipTrigger>
        </div>
        <TooltipContent>
          Settings
        </TooltipContent>
      </Tooltip>
      <DialogContent className="w-[320px] max-w-[calc(100%-2rem)] rounded-lg p-4">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-sm font-medium text-muted-foreground">
            Settings
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <ModelChoiceMenu display="row" />
          <div className="mx-1 my-1 h-px bg-border/70" />
          <SearchEngineChoiceMenu />
          <MemorySearchChoiceMenu available={memorySearchAvailable} />
          <CodeInterpreterChoiceMenu />
          <ImageGenMenu />
        </div>
      </DialogContent>
    </Dialog>
  )
}
