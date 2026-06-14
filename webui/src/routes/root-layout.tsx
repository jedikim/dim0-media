import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SidebarLabel } from "@/components/sidebar/sidebar-label"
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { StyleDefaultsProvider } from '@/features/board/style-provider'
import { useQueryClient } from '@tanstack/react-query'

import { useAppStore } from '@/store'
import { clearTokens } from '@/features/signin/auth-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBoardAppStore } from '@/features/board/harness/store/board-app-store'
import { useAuth } from '@/features/signin/hooks/auth'
import { initConnectionState } from '@/features/connection/connection-state'
import { OfflineOverlay } from '@/features/connection/offline-overlay'
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

  const isAuthed = userId !== 'root'

  // do not show shell on auth pages (prevents flicker / overlap)
  const onAuthPage = useMemo(
    () => location.pathname === '/signin' || location.pathname === '/signup' || location.pathname === '/verify-email',
    [location.pathname]
  )
  const showShell = isAuthed && !onAuthPage
  const presentationMode = useBoardAppStore(s => s.presentationMode)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const effectiveSidebarOpen = presentationMode ? false : sidebarOpen

  useEffect(() => {
    if (presentationMode) {
      setSidebarOpen(false)
    }
  }, [presentationMode])

  useEffect(() => {
    initConnectionState()
  }, [])

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

  return (
    <ThemeProvider>
      <StyleDefaultsProvider>
        <OfflineOverlay />
        <main>
          {showShell ? (
            <SidebarProvider open={effectiveSidebarOpen} onOpenChange={setSidebarOpen}>
              {!presentationMode && <AppSidebar onLogout={onLogout} />}
              <SidebarInset className='overflow-hidden'>
                <header className="flex h-16 shrink-0 items-center gap-2 p-4 absolute top-0 inset-x-0 z-50">
                  {!presentationMode && <SidebarTrigger className="-ml-1" />}
                  {!presentationMode && <div className="hidden md:block"><SidebarLabel /></div>}
                  {!presentationMode && <div className="md:hidden"><SidebarLabel mobileContextOnly /></div>}
                </header>

                <div className="flex flex-1 w-full min-w-0">
                  <div className="relative flex-1 min-w-0">
                    <Outlet />
                  </div>
                  <Toaster position="top-right" closeButton toastOptions={{ style: { borderRadius: 'var(--radius-xl)' } }} />
                </div>
              </SidebarInset>
            </SidebarProvider>
          ) : (
            <div className="fixed inset-0">
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
