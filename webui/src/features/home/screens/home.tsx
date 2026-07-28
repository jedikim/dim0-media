import { Chat } from "@/features/agent/components/chat-view"
import { BoardsHome } from "@/features/board/screens/boards-home"
import { NoteIcon } from "@/components/icons"

/**
 * HomePage displaying dashboard, chat, and subscriptions.
 */
export const HomePage = () => {
  return (
    <div className="absolute inset h-full w-full min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin">
      <div className="w-full flex flex-col items-center justify-center gap-16 py-8">
        <Chat className="relative sm:h-[350px] h-[400px]" autoCreateBoard />
        <div className='text-left max-w-[900px] w-full border-b border-border'>
          <h3 className="transition-all text-lg font-medium py-1 px-4 flex flex-row items-center gap-2">
            <NoteIcon className='w-5 h-5' strokeWidth={2} />
            <span>Note Boards</span>
          </h3>
        </div>
        <BoardsHome className="h-auto" hideTitle />
      </div>
    </div>
  )
}
