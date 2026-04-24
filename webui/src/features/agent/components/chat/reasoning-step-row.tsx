import { useState } from "react"
import { ArrowCollapseIcon, ArrowExpandIcon } from "@/components/icons"
import type { ReasoningTextStep } from "../../types/stream"
import { ThinkingDots } from "@/components/animations/thinking-indicator"
import { MarkdownView } from "@/components/markdown/markdown-view"
import { cn } from "@/lib/utils"


/**
 * Renders one raw reasoning text step in the merged assistant timeline.
 */
export const ReasoningStepRow = ({
  step,
  isStreaming,
}: {
  step: ReasoningTextStep
  isStreaming?: boolean
}) => {
  const [viewMore, setViewMore] = useState(false)
  const hasReasoningDetails = !isStreaming && step.reasoning !== ""
  const isSynthesis = step.isSynthesis === true

  if (!isStreaming && step.message === "" && step.reasoning === "") {
    return null
  }

  const divClass = cn(
    "w-full py-1 px-2",
    isSynthesis && "rounded-xl md:p-4 p-2 shadow-sm border border-border/60 bg-card/70",
    !isStreaming && isSynthesis && "max-h-[70vh] overflow-y-auto pr-1 scrollbar-thin"
  )

  return (
    <div
      className={divClass}
    >
      {isSynthesis && (
        <div className='pb-2 text-center text-sm font-medium text-muted-foreground font-mono'>
          Synthesis
        </div>
      )}
      {hasReasoningDetails && (
        <div className='mt-2 mb-2'>
          <button
            className='inline-flex items-center gap-1 text-sm font-normal text-muted-foreground'
            onClick={() => setViewMore((value) => !value)}
          >
            <span>Reasoning</span>
            {viewMore ? (
              <ArrowCollapseIcon
                className='size-4'
                strokeWidth={2}
              />
            ) : (
              <ArrowExpandIcon
                className='size-4'
                strokeWidth={2}
              />
            )}
          </button>
          {viewMore && (
            <div className='mt-2 font-sans text-muted-foreground/80 rounded-lg border border-border p-2 bg-sidebar border-dashed [&_p]:!text-sm [&_li]:!text-sm italic'>
              <MarkdownView content={step.reasoning} />
            </div>
          )}
        </div>
      )}
      {step.message !== "" ? (
        <div
          className="font-sans text-base text-card-foreground"
        >
          <MarkdownView content={step.message} isStreaming={isStreaming} />
        </div>
      ) : isStreaming ? (
        <span className='inline-flex items-center gap-1 font-mono text-sm font-medium text-muted-foreground'>
          Thinking
          <ThinkingDots />
        </span>
      ) : null}
    </div>
  )
}
