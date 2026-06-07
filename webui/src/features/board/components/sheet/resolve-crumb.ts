import type { IconProperty } from "@/features/newsfeed/types/properties"
import { UNTITLED_LABEL } from "../../const"
import type { Note } from "../../types/note"


/** The slice of a canvas-store node's `data` a crumb cares about. */
export type CrumbNodeData = {
  label?: { markdown?: string }
  properties?: { iconData?: IconProperty }
}


export type ResolvedCrumb = {
  label: string
  icon: IconProperty["icon"] | null
}


/**
 * Resolve a crumb's display title + custom icon, preferring the live
 * canvas-store node over the path-query note. The store holds the
 * authoritative value for on-canvas notes (so a rename / icon change shows
 * at once); the path note is the fallback for off-canvas crumbs. `icon` is
 * the user's custom icon when set, else null (caller falls back to the kind
 * icon). Pure so it can be unit-tested without a store/provider.
 */
export function resolveCrumb(
  liveData: CrumbNodeData | undefined,
  pathNote: Note | undefined,
): ResolvedCrumb {
  const label =
    (liveData?.label?.markdown ?? pathNote?.label?.markdown)?.trim() || UNTITLED_LABEL
  const icon =
    liveData?.properties?.iconData?.icon ??
    pathNote?.properties?.iconData?.icon ??
    null
  return { label, icon }
}
