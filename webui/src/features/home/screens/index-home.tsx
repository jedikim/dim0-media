import { useAppStore } from "@/store"
import { isSignedIn } from "@/lib/auth"
import { BoardsHome } from "@/features/board/screens/boards-home"
import { HomePage } from "./home"


/**
 * Root route (`/`) — the universal front door. Signed-in users get the full
 * HomePage (chat + unified dashboard); signed-out users get the local board
 * dashboard only (no chat — that needs the backend). This is what lets the app
 * open to a working local-first experience without forcing sign-in.
 */
export function IndexHome() {
  const userId = useAppStore((s) => s.userId)
  return isSignedIn(userId) ? (
    <HomePage />
  ) : (
    <BoardsHome className="absolute inset-0 overflow-y-auto scrollbar-thin" />
  )
}
