import { ReasoningStepsView } from "./reasoning-steps"
import type { ChatMessage } from "../../types/chat"
import { ResponseActions } from "./actions/response-actions"
import { useMemo } from "react"
import { isReasoningTextStep, type ReasoningStep, type ReasoningTextStep } from "../../types/stream"
import { SourcesView } from "./sources-view"


const EMPTY_STEPS: ReasoningStep[] = []


/**
 * Renders the assistant message as a single merged process view.
 */
export const AssistantMessage = ({
  message,
}: {
  message: ChatMessage
}) => {
  const steps: ReasoningStep[] = message.properties.reasoning?.reasoning ?? EMPTY_STEPS
  const resp = { steps, sentAt: message.sentAt, isDeepResearch: message.isDeepResearch }

  const responseMarkdown = useMemo(
    () => steps.filter(isReasoningTextStep).map((step: ReasoningTextStep) => step.message).join(""),
    [steps]
  )

  return (
    <div className='w-full space-y-2'>
      <ReasoningStepsView
        response={resp}
        isStreaming={message.streaming || false}
      />
      {!message.streaming && <SourcesView answer={resp} />}
      {!message.streaming && responseMarkdown && (
        <ResponseActions
          message={responseMarkdown}
        />
      )}
    </div>
  )
}
