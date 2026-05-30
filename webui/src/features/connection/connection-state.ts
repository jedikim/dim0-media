import { useSyncExternalStore } from "react"
import { ConnectionDetector, type ConnectionStatus } from "./connection-detector"
import { pingServer } from "./ping-client"


/**
 * Process-wide connection-state singleton. Lives outside React so that
 * non-React code paths (the API fetch wrapper, the WS adapter) can
 * notify failure events without going through hooks.
 */


const detector = new ConnectionDetector({
  ping: () => pingServer(),
})


let initialised = false


/**
 * Mount once at app startup. Wires `navigator.onLine` events into the
 * detector. Safe to call multiple times; subsequent calls no-op.
 */
export const initConnectionState = (): void => {
  if (initialised) return
  if (typeof window === "undefined") return
  initialised = true

  if (!window.navigator.onLine) {
    detector.noteNetworkOffline()
  }
  window.addEventListener("offline", () => detector.noteNetworkOffline())
  window.addEventListener("online", () => detector.noteNetworkOnline())
}


/** Reactive subscription for components. */
export const useConnectionStatus = (): ConnectionStatus => {
  return useSyncExternalStore(
    (cb) => detector.subscribe(cb),
    () => detector.getStatus(),
    () => "online",
  )
}


/** Non-React access — current status. */
export const getConnectionStatus = (): ConnectionStatus => detector.getStatus()


/**
 * Report an HTTP failure (timeout / network error / unexpected status).
 * Idempotent under burst — the detector single-flights its probe.
 */
export const notifyHttpFailure = (): void => {
  detector.noteFailure()
}


/**
 * Report a WebSocket unexpected close (any code other than 1000/1001).
 */
export const notifyWsClose = (code: number): void => {
  if (code === 1000 || code === 1001) return
  detector.noteFailure()
}


/**
 * Predicate used by mutation paths to short-circuit when the app is
 * frozen. Mutations issued while offline must reject (no queue).
 */
export const isFrozen = (): boolean => detector.getStatus() === "offline"
