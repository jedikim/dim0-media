import { useConnectionStatus } from "./connection-state"


/**
 * Full-viewport non-dismissible modal shown when the connection-state
 * detector reports `offline`. Captures pointer events so the canvas
 * underneath can't receive drag/click while the app is frozen.
 *
 * The detector's own backoff loop unfreezes the app automatically as
 * soon as a ping succeeds — there's no manual "retry" button by
 * design (a button would race the loop and just trigger an extra ping).
 */
export const OfflineOverlay = () => {
  const status = useConnectionStatus()
  if (status !== "offline") return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="mx-4 max-w-md rounded-xl border border-border bg-background p-6 text-center shadow-lg">
        <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <span
            aria-hidden="true"
            className="block h-3 w-3 animate-pulse rounded-full bg-destructive"
          />
        </div>
        <h2 className="text-base font-semibold text-foreground">
          Can't reach the Dim0 server
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Check your internet connection. We'll reconnect automatically as soon
          as the server is reachable again.
        </p>
      </div>
    </div>
  )
}
