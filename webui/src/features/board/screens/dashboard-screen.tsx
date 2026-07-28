import { BoardsHome } from "./boards-home"


/**
 * The board dashboard screen (`/boards` and `/local`). Renders the unified
 * BoardsHome (on-device + synced groups); the signed-out `/local` route shows
 * only the on-device group.
 */
export const DashboardScreen = () => {
  return <BoardsHome className="absolute inset-0 overflow-y-auto scrollbar-thin" />
}
