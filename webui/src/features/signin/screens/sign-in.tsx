import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, Link } from "@tanstack/react-router"
import { decodeJwt, resolveBillingPlan } from "@/lib/decode-jwt"
import { useAppStore } from "@/store"
import { getAuthMethods, getEmailVerificationStatus, googleSignin, type TokenPayload, signin } from "@/api"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Loader2Icon, LockIcon, MailIcon } from "@/components/icons"
import { PasswordInput } from "../components/password-input"
import { renderGoogleSigninButton } from "../lib/google-connect"
import { desktopGoogleSignin } from "../lib/desktop-google"
import { isTauri } from "@/platform"

/** Renders the sign-in screen and routes successful authentication into the app. */
export function SigninPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setUserId = useAppStore(s => s.setUserId)
  const setUserEmail = useAppStore(s => s.setUserEmail)
  const setUserPlan = useAppStore(s => s.setUserPlan)
  const setEmailVerificationEnabled = useAppStore(s => s.setEmailVerificationEnabled)
  const setEmailVerified = useAppStore(s => s.setEmailVerified)
  const googleButtonRef = React.useRef<HTMLDivElement | null>(null)
  const renderedGoogleClientIdRef = React.useRef<string | null>(null)
  const renderingGoogleClientIdRef = React.useRef<string | null>(null)

  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [googleError, setGoogleError] = React.useState<string | null>(null)

  const authMethodsQuery = useQuery({
    queryKey: ["auth-methods"],
    queryFn: getAuthMethods,
  })

  const completeSignin = React.useCallback(async (token: TokenPayload) => {
    queryClient.clear()
    const p = decodeJwt(token.access_token)
    if (p.sub) setUserId(String(p.sub))
    if (typeof p.email === "string") setUserEmail(p.email)
    setUserPlan(resolveBillingPlan(p))
    const status = await getEmailVerificationStatus()
    setEmailVerificationEnabled(status.enabled)
    setEmailVerified(status.verified)
    if (status.enabled && !status.verified) {
      navigate({ to: "/verify-email", replace: true })
      return
    }
    navigate({ to: "/", replace: true })
  }, [navigate, queryClient, setEmailVerificationEnabled, setEmailVerified, setUserEmail, setUserId, setUserPlan])

  const localSigninMutation = useMutation({
    mutationFn: () => signin(email, password),
    onMutate: () => setGoogleError(null),
    onSuccess: completeSignin,
  })

  const googleSigninMutation = useMutation({
    mutationFn: (idToken: string) => googleSignin(idToken),
    onMutate: () => setGoogleError(null),
    onSuccess: completeSignin,
    onError: error => {
      setGoogleError((error as Error).message || "Unable to continue with Google")
    },
  })

  // Desktop: GIS can't run in the webview, so sign in via the system browser
  // (loopback + PKCE). Uses the "Desktop app" OAuth client, exchanged server-side.
  const desktopGoogleMutation = useMutation({
    mutationFn: (clientId: string) => desktopGoogleSignin(clientId),
    onMutate: () => setGoogleError(null),
    onSuccess: completeSignin,
    onError: error => {
      setGoogleError((error as Error).message || "Unable to continue with Google")
    },
  })

  React.useEffect(() => {
    if (isTauri()) return // web-only: the GIS button doesn't work in the desktop webview
    const authMethods = authMethodsQuery.data
    const target = googleButtonRef.current
    const clientId = authMethods?.google_client_id
    if (!authMethods?.google || !clientId || !target) return
    if (renderedGoogleClientIdRef.current === clientId || renderingGoogleClientIdRef.current === clientId) return

    let cancelled = false
    renderingGoogleClientIdRef.current = clientId

    renderGoogleSigninButton({
      clientId,
      element: target,
      onCredential: response => {
        if (cancelled) return
        if (!response.credential) {
          setGoogleError("Google did not return a credential")
          return
        }
        googleSigninMutation.mutate(response.credential)
      },
    }).then(() => {
      if (cancelled) return
      renderedGoogleClientIdRef.current = clientId
    }).catch(error => {
      if (cancelled) return
      setGoogleError((error as Error).message || "Unable to load Google sign in")
    }).finally(() => {
      if (renderingGoogleClientIdRef.current === clientId) {
        renderingGoogleClientIdRef.current = null
      }
    })

    return () => {
      cancelled = true
    }
  }, [authMethodsQuery.data, googleSigninMutation])

  const authMethods = authMethodsQuery.data
  const desktop = isTauri()
  const showLocalSignin = authMethods?.local ?? true
  // Web uses GIS (needs the web client id); desktop uses the system-browser flow
  // (needs the "Desktop app" client id). Never both.
  const showGoogleWeb = !desktop && Boolean(authMethods?.google && authMethods.google_client_id)
  // Desktop availability is independent of the web client — the backend only
  // returns google_desktop_client_id when the Desktop OAuth client is configured,
  // so its presence alone gates the button (a deploy may have desktop but no web).
  const showGoogleDesktop = desktop && Boolean(authMethods?.google_desktop_client_id)
  const showSeparator = showLocalSignin && (showGoogleWeb || showGoogleDesktop)
  const localError = localSigninMutation.isError
    ? (localSigninMutation.error as Error).message || "Unable to sign in"
    : null

  return (
    <div className="w-full max-w-md mx-auto">
      <Card className="bg-card text-card-foreground border border-border shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl flex flex-col items-center justify-center gap-2">
            <img src="/dim0.svg" alt="Dim0 Logo" className="h-12 w-12 aspect-square object-contain" />
            <span className="text-muted-foreground">Welcome back!</span>
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Sign in to continue to your workspace
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={e => {
              e.preventDefault()
              if (!showLocalSignin) return
              localSigninMutation.mutate()
            }}
          >
            {showLocalSignin ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      autoFocus
                      className="pl-9"
                    />
                    <MailIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" strokeWidth={2} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <PasswordInput
                      id="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="pl-9 pr-9"
                    />
                    <LockIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" strokeWidth={2} />
                  </div>
                </div>

                {localError ? (
                  <p className="text-sm text-destructive">
                    {localError}
                  </p>
                ) : null}

                <Button type="submit" className="w-full" disabled={localSigninMutation.isPending || authMethodsQuery.isLoading}>
                  {localSigninMutation.isPending ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      Signing in…
                    </span>
                  ) : (
                    "Sign in"
                  )}
                </Button>
              </>
            ) : null}

            {showSeparator ? (
              <div className="space-y-3">
                <Separator />
                <p className="text-center text-sm text-muted-foreground">or</p>
              </div>
            ) : null}

            {showGoogleWeb ? (
              <div className="space-y-3">
                {googleError ? (
                  <p className="text-sm text-destructive">{googleError}</p>
                ) : null}
                <div className="w-full h-9 overflow-hidden rounded-md border border-border bg-white flex items-center justify-center">
                  <div className="w-full h-full flex items-center justify-center scale-[1.02] origin-center" ref={googleButtonRef} />
                </div>
                {googleSigninMutation.isPending ? (
                  <div className="flex items-center justify-center text-sm text-muted-foreground gap-2">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    Connecting to Google…
                  </div>
                ) : null}
              </div>
            ) : null}

            {showGoogleDesktop ? (
              <div className="space-y-2">
                {googleError ? (
                  <p className="text-sm text-destructive">{googleError}</p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => desktopGoogleMutation.mutate(authMethods!.google_desktop_client_id!)}
                  disabled={desktopGoogleMutation.isPending}
                >
                  {desktopGoogleMutation.isPending ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      Continue in your browser…
                    </span>
                  ) : (
                    "Continue with Google"
                  )}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Opens your browser to sign in, then returns here.
                </p>
              </div>
            ) : null}

            {!authMethodsQuery.isLoading && !showLocalSignin && !showGoogleWeb && !showGoogleDesktop ? (
              <p className="text-sm text-destructive">
                No sign-in methods are currently available.
              </p>
            ) : null}

            {authMethodsQuery.isError ? (
              <p className="text-sm text-destructive">
                {(authMethodsQuery.error as Error).message || "Unable to load sign-in methods"}
              </p>
            ) : null}

            <p className="text-center text-xs text-muted-foreground">
              By signing in, you agree to our{" "}
              <a
                href="https://www.dim0.net/terms"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Terms
              </a>{" "}
              and{" "}
              <a
                href="https://www.dim0.net/privacy"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Privacy Policy
              </a>
              .
            </p>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Don’t have an account?{" "}
                <Link to="/signup" className="font-medium underline">
                  Create one
                </Link>
              </span>
              <Link to="/forgot-password" className="text-muted-foreground underline">
                Forgot password?
              </Link>
            </div>

            <div className="text-center">
              <Link to="/" className="text-sm text-muted-foreground underline underline-offset-2">
                ← Back to boards
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
