import type { IconProperty } from "@/features/newsfeed/types/properties"
import type { BoardContentItem } from "./list-board-contents"


/**
 * Returns a new list with the matching item's `iconData` replaced. Used
 * as the updater for `queryClient.setQueriesData` so the sidebar tree
 * reflects an icon change immediately, before the WS persist (local
 * path) or the HTTP round-trip (REST path) lands.
 *
 * - Passes `undefined` through unchanged so a `setQueriesData` call on
 *   an uncached query level is a clean no-op (matches React Query's
 *   updater contract).
 * - Non-matching items are returned by reference; only the matching
 *   row gets a fresh object.
 * - `next = null` clears the icon (covers the Remove path).
 */
export const applyIconUpdateToBoardContents = (
  items: BoardContentItem[] | undefined,
  nodeId: string,
  next: IconProperty["icon"] | null,
): BoardContentItem[] | undefined => {
  if (!items) return items
  return items.map((item) =>
    item.id === nodeId ? { ...item, iconData: next } : item,
  )
}
