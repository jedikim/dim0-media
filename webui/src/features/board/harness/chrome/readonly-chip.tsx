import { useBoardAppStore } from "../store/board-app-store"


/**
 * Compact "Read-only" indicator that lives in the top-right chrome row
 * alongside save status, peer chip, share, etc. Shown only when the
 * signed-in user is a viewer on the current board — the same gate
 * that hides the Share button.
 *
 * Replaces the previous top-center floating banner. The shorter
 * wording is on purpose — the server still rejects writes with
 * `op-rejected reason="read-only"` if a viewer somehow tries; this
 * chip is the user-facing reminder, not the enforcement.
 *
 * Hidden in presentation mode where the read-only state is implicit.
 */
export function HarnessReadonlyChip() {
  const boardRole = useBoardAppStore((s) => s.boardRole)
  const presentationMode = useBoardAppStore((s) => s.presentationMode)

  if (boardRole !== "viewer") return null
  if (presentationMode) return null

  return (
    <span
      className="px-1 text-xs font-medium text-amber-600 dark:text-amber-400"
      role="status"
      aria-label="Board is read-only"
    >
      Read-only
    </span>
  )
}
