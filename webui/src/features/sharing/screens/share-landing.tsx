import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { getAccessToken } from "@/features/signin/auth-storage"
import { useAppStore } from "@/store"
import { acceptShareLink, previewShareLink, type ShareRole } from "../api"


type Phase = "checking-auth" | "needs-signin" | "loading" | "ready" | "accepting" | "error"


/**
 * Landing route for `/share/<token>`. Three high-level paths:
 *
 *  1. Not signed in: the token is stashed in sessionStorage and the
 *     user is redirected to /signin. After auth they can click the
 *     link again (or a future polish pass can drain pending tokens
 *     automatically from the root layout).
 *  2. Signed in + link valid: render a small "X invited you to ..."
 *     panel with an Open button that consumes the link and navigates
 *     into the board.
 *  3. Link unknown / revoked: friendly error with a way back home.
 */
export function ShareLandingScreen() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.userId)
  const params = useParams({ strict: false }) as { token?: string }
  const token = params.token ?? ""
  const [phase, setPhase] = useState<Phase>("checking-auth")
  const [info, setInfo] = useState<{ graph_uid: string; role: ShareRole } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError("Missing share token in the URL.")
      setPhase("error")
      return
    }
    if (!getAccessToken()) {
      try {
        sessionStorage.setItem("dim0:pendingShareToken", token)
      } catch {
        // Quota errors etc. — harmless to ignore.
      }
      setPhase("needs-signin")
      return
    }
    setPhase("loading")
    let cancelled = false
    previewShareLink(token)
      .then((res) => {
        if (cancelled) return
        setInfo(res)
        setPhase("ready")
      })
      .catch(() => {
        if (cancelled) return
        setError("This link is no longer active. Ask the owner for a new one.")
        setPhase("error")
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const onOpen = async () => {
    setPhase("accepting")
    try {
      const result = await acceptShareLink(token)
      // Best-effort: clear the pending-token marker since we used it.
      try {
        sessionStorage.removeItem("dim0:pendingShareToken")
      } catch {
        // ignore
      }
      if (!result.already_member) {
        toast.success(
          `Added to board as ${result.role}.`,
        )
      }
      // Refresh the sidebar's "Shared with me" section — without
      // this, the newly-accessible board doesn't show up until a
      // full page reload. Triggered after the accept regardless of
      // already_member, since membership-role can also change.
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["listBoards", userId] })
      }
      navigate({ to: "/boards/$id", params: { id: result.graph_uid } })
    } catch {
      setError("Couldn't accept the invitation. Try again.")
      setPhase("error")
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border border-border bg-background p-6 shadow-md">
        {phase === "checking-auth" || phase === "loading" ? (
          <Status text="Checking invitation…" />
        ) : phase === "needs-signin" ? (
          <SignInPanel onGoSignIn={() => navigate({ to: "/signin" })} />
        ) : phase === "ready" && info ? (
          <ReadyPanel role={info.role} onOpen={onOpen} />
        ) : phase === "accepting" ? (
          <Status text="Joining the board…" />
        ) : (
          <ErrorPanel
            message={error ?? "Unknown error."}
            onGoHome={() => navigate({ to: "/" })}
          />
        )}
      </div>
    </div>
  )
}


function Status({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}


function SignInPanel({ onGoSignIn }: { onGoSignIn: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-lg font-semibold">You've been invited to a board</h1>
      <p className="text-sm text-muted-foreground">
        Sign in to your Dim0 account to accept this invitation.
      </p>
      <Button onClick={onGoSignIn} className="mt-2">
        Sign in
      </Button>
    </div>
  )
}


function ReadyPanel({ role, onOpen }: { role: ShareRole; onOpen: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-lg font-semibold">You've been invited</h1>
      <p className="text-sm text-muted-foreground">
        {role === "member"
          ? "You'll be able to view and edit this board."
          : "You'll have view-only access to this board."}
      </p>
      <Button onClick={onOpen} className="mt-2">
        Open board
      </Button>
    </div>
  )
}


function ErrorPanel({ message, onGoHome }: { message: string; onGoHome: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-lg font-semibold">This invitation isn't usable</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="secondary" onClick={onGoHome} className="mt-2">
        Back home
      </Button>
    </div>
  )
}
