/**
 * Desktop-only: reflect the window's fullscreen + maximized state as
 * `tauri-fullscreen` / `tauri-maximized` classes on `<html>`.
 *
 * `tauri-fullscreen` hides the custom title bar (nothing to drag/close over a
 * fullscreen surface). Both classes also drop the window's rounded corners: a
 * frameless transparent window that's edge-to-edge (fullscreen OR maximized)
 * must be square, else the desktop shows through the rounded corner cut-outs.
 */

/**
 * Track fullscreen + maximized state and keep the classes in sync. Safe to call
 * only on the Tauri build (dynamically imports the window API so it never lands
 * in the web bundle). Runs for the app's lifetime; no teardown needed.
 */
export async function initFullscreenClass(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const win = getCurrentWindow()

  let checking = false
  let pending = false
  const apply = async (): Promise<void> => {
    // Collapse the burst of resize events, but keep a trailing run: a resize that
    // arrives mid-check (before the state settles) sets `pending`, so we re-check
    // once after — otherwise we could latch onto the mid-transition state forever.
    if (checking) {
      pending = true
      return
    }
    checking = true
    try {
      const [fullscreen, maximized] = await Promise.all([win.isFullscreen(), win.isMaximized()])
      document.documentElement.classList.toggle("tauri-fullscreen", fullscreen)
      document.documentElement.classList.toggle("tauri-maximized", maximized)
    } catch {
      // window gone / IPC unavailable — leave the classes as-is
    } finally {
      checking = false
      if (pending) {
        pending = false
        void apply()
      }
    }
  }

  await apply()
  // Entering/leaving macOS fullscreen resizes the window, so resize is the signal.
  await win.onResized(() => {
    void apply()
  })
}
