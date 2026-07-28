import clsx from "clsx"
import { useChat } from "@/features/agent/hooks/chat-context"
import { CopyAnswer } from "./copy-answer"
import { SaveAsNote } from "./save-as-note"
import { useListChats } from "@/features/agent/api/list-chats"
import { useAppStore } from "@/store"


type ResponseActionsLayout = "horizontal" | "vertical-compact"


/**
 * Component that renders action buttons for a chat response. Supports the
 * inline horizontal layout used in the chat thread and a compact vertical
 * icon-only layout for the floating answer card.
 */
export const ResponseActions = ({
  message,
  saveAsIs = false,
  layout = "horizontal",
}: {
  message: string
  saveAsIs?: boolean
  layout?: ResponseActionsLayout
}) => {
  const { chatId } = useChat()
  const userId = useAppStore(s => s.userId)

  const { data: chatList } = useListChats({ graphUid: null, userId })

  const chat = chatList?.find((c) => c.uid === chatId)
  const attachedBoardId = chat?.graphUid
  const compact = layout === "vertical-compact"

  return (
    <div
      className={clsx(
        "flex",
        compact ? "flex-col items-center gap-1" : "flex-row items-center gap-2 ml-1",
      )}
    >
      <CopyAnswer answer={message} compact={compact} />
      {/* SaveAsNote self-routes: backend board-picker online, in-browser
          transform on local boards. */}
      <SaveAsNote message={message} type="notify" saveAsIs={saveAsIs} boardId={attachedBoardId} compact={compact} />
      <SaveAsNote message={message} type="mapify" boardId={attachedBoardId} compact={compact} />
      <SaveAsNote message={message} type="schemify" boardId={attachedBoardId} compact={compact} />
    </div>
  )
}
