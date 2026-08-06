import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SidebarLabel } from "@/components/sidebar/sidebar-label"
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { StyleDefaultsProvider } from '@/features/board/style-provider'
import { useQueryClient } from '@tanstack/react-query'

import { useAppStore } from '@/store'
import { isSignedIn } from '@/lib/auth'
import { clearTokens } from '@/features/signin/auth-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBoardAppStore } from '@/features/board/harness/store/board-app-store'
import { useAuth } from '@/features/signin/hooks/auth'
import { getBillingPublicConfig } from '@/features/user-settings/api/billing'
import { initConnectionState } from '@/features/connection/connection-state'
import { OfflineOverlay } from '@/features/connection/offline-overlay'
import { ConnectionIndicator } from '@/features/connection/connection-indicator'
import { isTauri } from '@/platform'
import { DesktopBrand, WindowControls } from '@/features/desktop/desktop-chrome'
import { AuthGraphTexture } from '@/features/signin/components/auth-graph-texture'

export function RootLayout() {
  // only hydrates store from token; does not navigate
  useAuth()

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { location } = useRouterState()

  // Zustand state
  const userId = useAppStore(s => s.userId)
  const setUserId = useAppStore(s => s.setUserId)
  const setUserEmail = useAppStore(s => s.setUserEmail)
  const setUserPlan = useAppStore(s => s.setUserPlan)
  const setEmailVerificationEnabled = useAppStore(s => s.setEmailVerificationEnabled)
  const setEmailVerified = useAppStore(s => s.setEmailVerified)
  const setBillingActive = useAppStore(s => s.setBillingActive)

  // Billing is "active" only if the backend has the flag AND the Stripe keys —
  // a fact the web container can't compute. Consume the backend's answer so a
  // flag-set-but-keyless deploy correctly reads as OSS (no tiers/limits). Only
  // signed-in users: billing UI/limits never apply signed-out, and the
  // local-first front door makes zero backend calls when signed out. The
  // build-flag seed covers the pre-fetch window.
  useEffect(() => {
    if (!isSignedIn(userId)) return
    let cancelled = false
    getBillingPublicConfig()
      .then((cfg) => { if (!cancelled) setBillingActive(cfg.billing_enabled) })
      .catch(() => { /* keep the seeded default on error */ })
    return () => { cancelled = true }
  }, [userId, setBillingActive])

  const onLogout = useCallback(() => {
    clearTokens()
    queryClient.clear()
    setUserId('root')
    setUserEmail('root@localhost')
    setUserPlan('free')
    setEmailVerificationEnabled(false)
    setEmailVerified(true)
    navigate({ to: '/signin', replace: true })
  }, [navigate, queryClient, setEmailVerificationEnabled, setEmailVerified, setUserEmail, setUserId, setUserPlan])

  const isAuthed = isSignedIn(userId)

  // do not show shell on auth pages (prevents flicker / overlap)
  const onAuthPage = useMemo(
    () => location.pathname === '/signin' || location.pathname === '/signup' || location.pathname === '/verify-email',
    [location.pathname]
  )
  // One shell for everyone (auth pages excepted): signed-out users get the same
  // frame, with the sidebar showing only local boards + a sign-in CTA. The
  // backend-coupled bits stay dormant logged-out (board/chat lists are
  // `enabled: !!userId`; the ping only starts when authed).
  const showShell = !onAuthPage
  // Still used to keep offline-first on local boards: the connectivity overlay is
  // suppressed on a /local route so a device-only board never shows "server down".
  const isLocalRoute = location.pathname.startsWith("/local")
  // The synced board currently open (if any) — drives the board-aware overlay:
  // a downloaded board stays usable offline (non-blocking), an undownloaded one
  // keeps the blocking modal. `/boards/:id[/...surface]` → the id segment.
  const syncedBoardId = useMemo(() => {
    const match = location.pathname.match(/^\/boards\/([^/]+)/)
    return match ? match[1] : null
  }, [location.pathname])
  // Standalone desktop build: draw our own frameless title bar (brand + custom
  // window controls) instead of the OS chrome.
  const isDesktop = isTauri()
  const presentationMode = useBoardAppStore(s => s.presentationMode)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const effectiveSidebarOpen = presentationMode ? false : sidebarOpen

  useEffect(() => {
    if (presentationMode) {
      setSidebarOpen(false)
    }
  }, [presentationMode])

  useEffect(() => {
    // Start connectivity detection only once the user is signed in. Signed-out
    // (local-first) sessions never ping the backend, so a device-only workflow
    // makes zero server contact. The overlay itself is additionally gated on
    // `!isLocalRoute` at render, so a local board never shows "server down".
    if (!isAuthed) return
    initConnectionState()
  }, [isAuthed])

  // When the user finishes sign-in after clicking a share link, route
  // them back to /share/<token> automatically so they don't have to
  // dig the URL out of their email/chat a second time. Only fires
  // once a successful sign-in transition has been observed (isAuthed
  // flips from false to true).
  useEffect(() => {
    if (!isAuthed) return
    let token: string | null = null
    try {
      token = sessionStorage.getItem("dim0:pendingShareToken")
    } catch {
      token = null
    }
    if (!token) return
    try {
      sessionStorage.removeItem("dim0:pendingShareToken")
    } catch {
      // ignore
    }
    // Skip if we're already on the share landing — avoids a no-op
    // loop and lets the share screen's own consume logic run.
    if (location.pathname.startsWith("/share/")) return
    navigate({ to: "/share/$token", params: { token } })
  }, [isAuthed, location.pathname, navigate])

  // Board/content area (same on web + desktop). The board's own header + toolbar
  // float inside this over the canvas, so the desktop title LINE must live above
  // it — not overlap it.
  const outletArea = (
    <div className="flex flex-1 w-full min-w-0">
      <div className="relative flex-1 min-w-0">
        <Outlet />
      </div>
      <Toaster position="top-right" closeButton toastOptions={{ style: { borderRadius: 'var(--radius-xl)' } }} />
    </div>
  )

  // The left cluster (sidebar toggle + board title) shared by the web floating
  // header and the desktop title line.
  const navCluster = !presentationMode && (
    <>
      <SidebarTrigger className="-ml-1" />
      {isDesktop && <DesktopBrand />}
      <div className="hidden md:block"><SidebarLabel /></div>
      <div className="md:hidden"><SidebarLabel mobileContextOnly /></div>
    </>
  )

  return (
    <ThemeProvider>
      <StyleDefaultsProvider>
        {isAuthed && !isLocalRoute && <OfflineOverlay boardId={syncedBoardId} />}
        <main>
          {showShell ? (
            <SidebarProvider
              open={effectiveSidebarOpen}
              onOpenChange={setSidebarOpen}
              className={isDesktop ? "flex-col h-svh" : undefined}
            >
              {isDesktop ? (
                <>
                  {/* Title LINE — its own reserved row above the sidebar + content,
                      so the board toolbar (which floats below) never overlaps it. */}
                  <div
                    data-tauri-drag-region
                    className="z-50 flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-3 [.tauri-fullscreen_&]:hidden"
                  >
                    {navCluster}
                    <div className="ml-auto flex items-center gap-2 self-stretch">
                      <ConnectionIndicator />
                      <WindowControls />
                    </div>
                  </div>
                  <div className="flex min-h-0 w-full flex-1">
                    {!presentationMode && <AppSidebar onLogout={onLogout} />}
                    <SidebarInset className="overflow-hidden">{outletArea}</SidebarInset>
                  </div>
                </>
              ) : (
                <>
                  {!presentationMode && <AppSidebar onLogout={onLogout} />}
                  <SidebarInset className="overflow-hidden">
                    <header className="flex h-16 shrink-0 items-center gap-2 p-4 absolute top-0 inset-x-0 z-50">
                      {navCluster}
                      <div className="ml-auto"><ConnectionIndicator /></div>
                    </header>
                    {outletArea}
                  </SidebarInset>
                </>
              )}
            </SidebarProvider>
          ) : (
            <div className="fixed inset-0">
              {isDesktop && (
                <div
                  data-tauri-drag-region
                  className="absolute top-0 inset-x-0 z-50 flex h-11 items-center gap-2 px-3 [.tauri-fullscreen_&]:hidden"
                >
                  <DesktopBrand />
                  <div className="ml-auto self-stretch"><WindowControls /></div>
                </div>
              )}
              <AuthBackground />
              <div className="absolute inset-0 grid place-items-center px-4 overflow-hidden">
                <Outlet />
              </div>

              <Toaster
                position="top-right"
                closeButton
                toastOptions={{ style: { borderRadius: 'var(--radius-xl)' } }}
              />
            </div>
          )}
        </main>
      </StyleDefaultsProvider>
    </ThemeProvider>
  )
}

/**
 * Full-screen auth background:
 * - subtle dot grid overlay (matches the dim0.net landing-page graph paper)
 * - decorative graph texture layered on top
 * - fractal-noise paper grain (shared with the board) for a tactile finish
 */
export function AuthBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* dot grid overlay */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--foreground) 55%, transparent) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* decorative graph layered on top of the dot grid */}
      <AuthGraphTexture />

      {/* fractal-noise paper grain (same substrate the board uses) */}
      <div className="board-paper-grain auth-paper-grain" />
    </div>
  )
}
