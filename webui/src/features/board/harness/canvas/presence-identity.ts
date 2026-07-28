/**
 * Local presence identity (name + color) for a collab session.
 *
 * Same algorithm as the legacy client's `colorForId` so a user gets the SAME
 * color on both the legacy and v2 sync paths (and across their own tabs). The
 * duplication is intentional and temporary — it avoids touching the legacy
 * client (slated for deletion); fold into one when that happens.
 */
import type { PresenceState } from "@canvas-harness/core"


/** Deterministic HSL color per id — stable per user across tabs/clients. */
export const colorForId = (id: string): string => {
  let h = 0
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return `hsl(${Math.abs(h) % 360} 70% 55%)`
}


/**
 * Initial local presence: name from the email local-part, deterministic color.
 * Cursor / selection start empty and are filled in live by `useLocalPresence`.
 */
export const buildLocalPresence = (
  userEmail: string,
  userId: string | null | undefined,
  clientId: string,
): Partial<PresenceState> => ({
  name: userEmail.split("@")[0] || "Anonymous",
  color: colorForId(userId ?? clientId),
  cursor: null,
  selection: [],
  editing: null,
})
