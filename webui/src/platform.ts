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
