import { useAppStore } from "@/store"


/**
 * Sentinel `userId` for a signed-out session. It is a NON-EMPTY string, so
 * `!!userId` is truthy while logged out — which is why auth-gating must use
 * `isSignedIn`, not `!!userId` (the latter fires authed requests logged-out →
 * 401 → forced sign-in).
 */
export const LOGGED_OUT_USER_ID = "root"


/** Whether a `userId` represents a real signed-in account (not the sentinel). */
export const isSignedIn = (userId: string | null | undefined): boolean =>
  !!userId && userId !== LOGGED_OUT_USER_ID


/** Reactive signed-in flag from the app store. */
export const useIsSignedIn = (): boolean =>
  isSignedIn(useAppStore((s) => s.userId))
