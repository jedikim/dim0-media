import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ImageGenerationIcon } from "@/components/icons"
import { useChatStore } from "@/features/agent/store/chat-store"
import { clsx } from "clsx"
import { useShallow } from "zustand/shallow"

// Component that allows users to enable or disable the image generation tool
export const ImageGenMenu = () => {
  const imageService = useChatStore(
    useShallow((state) => state.services.imageGeneration.find((s) => s.name === "openrouter")),
  )
  const enabledTools = useChatStore(useShallow((state) => state.enabledTools))
  const setEnabledTools = useChatStore((state) => state.setEnabledTools)

  const isEnabled = enabledTools.includes("image_generation")
  const isAvailable = imageService?.available || false

  const handleToggle = () => {
    if (!isAvailable) return
    if (isEnabled) {
      setEnabledTools(enabledTools.filter(tool => tool !== "image_generation"))
    } else {
      setEnabledTools([...enabledTools, "image_generation"])
    }
  }

  const tooltipText = isAvailable
    ? (isEnabled ? "Disable Image Generation" : "Enable Image Generation")
    : "Image Generation Unavailable"

  const buttonClass = clsx(
    "transition-all w-full my-icon px-2 py-1.5 rounded-md hover:bg-accent dark:hover:bg-accent/50 border border-transparent hover:border-border transition-colors flex flex-row items-center gap-2 text-left text-muted-foreground",
    !isAvailable && "opacity-50 cursor-not-allowed pointer-events-none",
  )
  const iconClass = clsx(
    "size-4 shrink-0",
    isEnabled ? "text-secondary-foreground" : "text-muted-foreground"
  )

  return (
    <Tooltip delayDuration={400}>
      <div className="w-full">
        <TooltipTrigger asChild>
          <button
            className={buttonClass}
            onClick={handleToggle}
            disabled={!isAvailable}
          >
            <ImageGenerationIcon className={iconClass} strokeWidth={2} />
            <span className="text-xs">Image generation</span>
          </button>
        </TooltipTrigger>
      </div>
      <TooltipContent>
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}
