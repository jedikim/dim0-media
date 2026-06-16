/**
 * Whether a keyboard event originated from a text-entry control — a focused
 * `<input>` / `<textarea>` or any `contenteditable` (TipTap editors included).
 *
 * Global `window`/`document` keydown shortcuts should bail on this so typing
 * keeps the native key behavior (e.g. Cmd+B bolds text instead of toggling the
 * sidebar). Used by every app-level keyboard handler.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true
  if (target.isContentEditable) return true
  return false
}
