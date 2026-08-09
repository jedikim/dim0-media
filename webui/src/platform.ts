/**
 * Runtime platform detection.
 *
 * `isTauri()` is true inside the Tauri desktop webview — the native shell injects
 * `__TAURI_INTERNALS__` on `window` before any app code runs — and false in a
 * plain browser. Kept dependency-free and synchronous so module-load-time config
 * (e.g. the services base URL, the storage engine choice) can branch on it.
 */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window


/**
 * True inside a **WebKit-based** Tauri webview — macOS (`WKWebView`) and Linux
 * (`WebKitGTK`), where `backdrop-filter` re-samples the backdrop every frame and
 * janks over a moving canvas. NOT Windows: `WebView2` is Chromium, where blur is
 * cheap. Distinguished by the `Chrome/` UA token (present in Chromium/WebView2,
 * absent in the Safari-family WebKit engines). Used to drop blur only where it
 * actually hurts.
 */
export const isWebKitWebview = (): boolean =>
  isTauri() && typeof navigator !== "undefined" && !/Chrome\//.test(navigator.userAgent)


/**
 * Open an external URL. On desktop (Tauri) this hands off to the OS default
 * browser via the `open_external` Rust command so payment/OAuth-style flows run
 * in a real browser instead of taking over the webview; on web it stays a normal
 * same-tab navigation, unchanged from the prior behavior.
 */
export const openExternalUrl = async (url: string): Promise<void> => {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("open_external", { url })
    return
  }
  window.location.assign(url)
}
