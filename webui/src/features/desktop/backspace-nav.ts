/**
 * Desktop-only: stop Backspace from navigating the webview back a page.
 *
 * The Tauri macOS WKWebView still treats Backspace (outside a text field) as
 * "history back" — a webview default that Chrome/Firefox dropped years ago, so
 * only the desktop app hits it. The symptom: pressing Backspace to delete
 * selected board nodes instead navigates to the previous route. canvas-harness's
 * delete handler runs regardless (it doesn't stop propagation), so cancelling
 * the default here removes the navigation without affecting deletion — and it
 * covers the no-selection case too.
 */

/**
 * Cancel Backspace's default back-navigation whenever focus is not an editable
 * field (so typing/erasing in inputs, textareas, and contenteditable is
 * untouched). Capture phase so it wins before anything that might stop
 * propagation. Runs for the app's lifetime; no teardown needed.
 */
export function disableBackspaceNavigation(): void {
  if (typeof window === "undefined") return
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Backspace") return
      const target = e.target as HTMLElement | null
      const editable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      if (!editable) e.preventDefault()
    },
    { capture: true },
  )
}
