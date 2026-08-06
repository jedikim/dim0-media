import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { preloadCanvasFonts } from './fonts'
import './index.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './query-client'
import { router } from './routes'
import { RouterProvider } from '@tanstack/react-router'
import { registerSW } from 'virtual:pwa-register'
import { isTauri, isWebKitWebview } from './platform'

/**
 * Registers the PWA service worker and keeps it up to date automatically.
 * Skipped on the Tauri desktop build — the app is served from the native shell,
 * not a web origin, so the offline SW is both unnecessary and unsupported there.
 */
if (!isTauri()) {
  registerSW({ immediate: true })
} else {
  // Desktop shell is frameless (decorations: false) with our own title bar +
  // window controls. This class drives the rounded-window CSS + title-bar chrome.
  document.documentElement.classList.add("tauri")
  // WebKit webviews (macOS/Linux, not Windows' Chromium WebView2) drop
  // canvas-overlay backdrop-blur via the `[.tauri-webkit_&]:` variant — it janks
  // there but is cheap on Chromium.
  if (isWebKitWebview()) document.documentElement.classList.add("tauri-webkit")
  // In fullscreen the title bar is hidden and the window is square.
  void import("./features/desktop/fullscreen-class").then(m => m.initFullscreenClass())
  // WKWebView treats Backspace as "history back"; stop it stealing node deletes.
  void import("./features/desktop/backspace-nav").then(m => m.disableBackspaceNavigation())
}

// Kick off canvas font loading before first paint so the board doesn't render
// with the `cursive` fallback (WebKit won't load a canvas-only font on its own).
preloadCanvasFonts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
