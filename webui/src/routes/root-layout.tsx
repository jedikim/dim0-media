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
import { useGraphStore } from '@/features/board/store/graph-store'
import { useAuth } from '@/features/signin/hooks/auth'

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
  const presentationMode = useGraphStore(s => s.presentationMode)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const effectiveSidebarOpen = presentationMode ? false : sidebarOpen

  useEffect(() => {
    if (presentationMode) {
      setSidebarOpen(false)
    }
  }, [presentationMode])

  return (
    <ThemeProvider>
      <StyleDefaultsProvider>
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
 * - soft "secondary" blobs
 * - subtle dot grid overlay (matches the dim0.net landing-page graph paper)
 */
export function AuthBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* soft secondary blobs */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-[40vh] w-[70vw] rounded-full bg-secondary-foreground/20 blur-3xl" />
      <div className="absolute -bottom-24 -left-24 h-[45vh] w-[55vw] rounded-full bg-secondary-foreground/15 blur-3xl" />
      <div className="absolute -bottom-40 -right-40 h-[35vh] w-[45vw] rounded-full bg-secondary-foreground/10 blur-3xl" />

      {/* dot grid overlay */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--foreground) 55%, transparent) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
    </div>
  )
}
