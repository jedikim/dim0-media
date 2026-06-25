import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useChatStore } from "@/features/agent/store/chat-store"
import {
  familyIcon,
  familyLabel,
} from "@/features/agent/types/llm"
import type { LlmOption } from "@/features/agent/types/services"
import { LockIcon } from "@/components/icons"
import { clsx } from "clsx"
import { useShallow } from "zustand/shallow"

type ModelChoiceMenuProps = {
  display?: "icon" | "row"
}

/**
 * ModelCard renders a model's label, with an optional tier hint, and dims it
 * when the model is unavailable.
 */
const ModelCard: React.FC<{ model: LlmOption }> = ({ model }) => {
  const clss = clsx(
    "flex-1 flex flex-row items-center gap-2 justify-between truncate",
    model.available === false ? "text-muted-foreground cursor-not-allowed pointer-events-none" : "",
  )

  return (
    <div className={clss}>
      <span className="truncate">{model.label}</span>
      {model.tier && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {model.tier}
        </span>
      )}
    </div>
  )
}

/**
 * ModelChoiceMenu is a component that allows users to select an AI model
 * from a dropdown menu. It uses the Select component from the UI library
 * to create a styled dropdown with model options.
 */
export const ModelChoiceMenu = ({ display = "icon" }: ModelChoiceMenuProps) => {
  const { llmModel, setLlmModel } = useChatStore()

  const availableModels = useChatStore(
    useShallow((state) => state.services.llm),
  )

  const handleModelChange = (value: string) => {
    setLlmModel(value)
  }

  // Group models by family (order preserved from the backend catalog)
  const modelsByFamily: Record<string, typeof availableModels> = {}
  for (const model of availableModels) {
    const family = model.family || "dim0"
    if (!modelsByFamily[family]) {
      modelsByFamily[family] = []
    }
    modelsByFamily[family].push(model)
  }

  const currentModel = availableModels.find((model) => model.name === llmModel)
  const currentFamily = currentModel?.family ?? "dim0"
  const CurrentFamilyIcon = familyIcon(currentFamily)
  const currentLabel = currentModel?.label ?? llmModel
  const isRow = display === "row"
  const triggerClassName = isRow
    ? "w-full rounded-md text-xs px-2 py-1.5 shadow-none hover:bg-accent [&>svg:not(.my-icon)]:hidden border border-transparent hover:border-border transition-colors justify-start gap-2 text-muted-foreground"
    : "w-auto rounded-md text-xs p-2 shadow-none border-none"

  return (
    <Select onValueChange={handleModelChange} value={llmModel}>
      <Tooltip delayDuration={400}>
        <div className={clsx(
          isRow ? "w-full" : "rounded-md bg-background backdrop-blur-md supports-[backdrop-filter]:bg-sidebar/50 border border-transparent hover:border-border transition-colors"
        )}>
          <TooltipTrigger asChild>
            <SelectTrigger className={triggerClassName} size="sm" hideChevron>
              <div className="flex items-center gap-2">
                {
                  isRow ? (
                    <>
                      <CurrentFamilyIcon size={16} />
                      <span className="text-xs truncate">Core LLM ({currentLabel})</span>
                    </>
                  ) : (
                    <CurrentFamilyIcon size={16} />
                  )
                }
              </div>
            </SelectTrigger>
          </TooltipTrigger>
        </div>
        <TooltipContent>Core LLM</TooltipContent>
      </Tooltip>

      <SelectContent side="top">
        <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
          <SelectGroup>
            <SelectLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Models
            </SelectLabel>
          </SelectGroup>

          {Object.keys(modelsByFamily).map((family) => {
            const familyModels = modelsByFamily[family]
            if (!familyModels || familyModels.length === 0) return null

            const FamilyIcon = familyIcon(family)

            return (
              <SelectGroup key={family} className="mt-1">
                <SelectLabel className="flex flex-row items-center gap-2 text-xs font-medium">
                  <FamilyIcon size={16} />
                  <span>{familyLabel(family)}</span>
                </SelectLabel>

                {familyModels.map((model) => {
                  const clName = clsx(
                    "relative w-full text-xs flex flex-row items-center gap-2 py-1.5",
                    !model.available
                      ? "text-muted-foreground cursor-not-allowed pointer-events-none"
                      : "",
                  )

                  return (
                    <SelectItem
                      key={model.name}
                      value={model.name}
                      className={clName}
                      disabled={!model.available}
                    >
                      <ModelCard model={model} />
                      {!model.available && (
                        <LockIcon
                          className="size-4 absolute right-2 top-1/2 -translate-y-1/2"
                          strokeWidth={2}
                        />
                      )}
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            )
          })}
        </div>
      </SelectContent>
    </Select>
  )
}
