import { useNavigate, useSearch } from "@tanstack/react-router"
import { HarnessCanvas } from "../harness/canvas"
import { useBoardAppStore } from "../harness/store/board-app-store"
import { FloatingAssistant } from "./flow/floating-assistant/floating-assistant"
import { CopilotSheet } from "./flow/copilot-sheet"


/**
 * Board entry-point. Mounts the canvas-harness board surface, the
 * floating-island AI composer at the bottom of the canvas, and the
 * full chat sheet drawer. Scope (boardId / rootId) is set on the
 * board-app-store by `BoardScreen`; this component reads from there.
 */
export const BoardView: React.FC = () => {
  const navigate = useNavigate()
  const boardId = useBoardAppStore((s) => s.boardId)
  const chatSheetOpen = useBoardAppStore((s) => s.chatSheetOpen)
  const setChatSheetOpen = useBoardAppStore((s) => s.setChatSheetOpen)
  const presentationMode = useBoardAppStore((s) => s.presentationMode)

  // current_chat_id from the URL — shared between the floating island
  // and the full chat sheet so opening one continues the same chat.
  const boardSearch = useSearch({
    strict: false,
    select: (s: { current_chat_id?: string }) => ({ currentChatId: s.current_chat_id }),
  })
  const currentChatId = boardSearch?.currentChatId

  return (
    <div className="absolute inset-0 h-full w-full overflow-hidden">
      <div className="relative h-full w-full bg-background">
        <HarnessCanvas />
        {!chatSheetOpen && !presentationMode && boardId && (
          <FloatingAssistant
            boardId={boardId}
            currentChatId={currentChatId}
            onOpenFullSheet={() => setChatSheetOpen(true)}
          />
        )}
        <CopilotSheet
          open={chatSheetOpen}
          onOpenChange={setChatSheetOpen}
          boardId={boardId ?? undefined}
          currentChatId={currentChatId}
          onOpenFullChat={(chatId) => {
            setChatSheetOpen(false)
            if (chatId) {
              navigate({
                to: "/chats/$id",
                params: { id: chatId },
                search: (prev: Record<string, unknown>) => ({
                  ...prev,
                  board_id: boardId || undefined,
                }),
              })
            }
          }}
        />
      </div>
    </div>
  )
}
