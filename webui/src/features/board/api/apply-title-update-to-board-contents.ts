import type { BoardContentItem } from "./list-board-contents"


/**
 * Returns a new list with the matching item's `label` replaced. Mirror of
 * `applyIconUpdateToBoardContents` for titles — used as the `setQueriesData`
 * updater so the sidebar tree reflects a rename immediately, before the WS
 * persist (local path) or HTTP round-trip (REST path) lands.
 *
 * - Passes `undefined` through unchanged so a `setQueriesData` call on an
 *   uncached query level is a clean no-op (matches React Query's contract).
 * - Non-matching items are returned by reference; only the matching row gets
 *   a fresh object.
 * - `label = null` / "" clears the title (the row falls back to "Untitled").
 */
export const applyTitleUpdateToBoardContents = (
  items: BoardContentItem[] | undefined,
  nodeId: string,
  label: string | null,
): BoardContentItem[] | undefined => {
  if (!items) return items
  return items.map((item) =>
    item.id === nodeId ? { ...item, label } : item,
  )
}
