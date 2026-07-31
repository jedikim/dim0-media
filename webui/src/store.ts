import { create } from "zustand/react"
import type { BillingPlan } from "@/lib/decode-jwt"
import { BILLING_ENABLED } from "@/config/billing"


/**
 * AppStore for managing application-wide state.
 */
export interface AppStore {
  userId: string
  userEmail: string
  userPlan: BillingPlan
  /**
   * Backend-authoritative "billing is active" (`is_billing_active`: the flag AND
   * all Stripe keys present). Hydrated at boot from `/billing/public-config`;
   * seeded from the build flag so a correctly-configured deploy doesn't flash.
   * Gate tiers/limits on THIS, never the raw `VITE_BILLING_ENABLED` flag — the
   * web container can't see the Stripe keys. See docs/adr/ADR-BILLING-001.
   */
  billingActive: boolean
  emailVerificationEnabled: boolean
  emailVerified: boolean
  setUserId: (userId: string) => void
  setUserEmail: (email: string) => void
  setUserPlan: (plan: BillingPlan) => void
  setBillingActive: (active: boolean) => void
  setEmailVerificationEnabled: (enabled: boolean) => void
  setEmailVerified: (verified: boolean) => void
}


/**
 * Create a Zustand store for managing application-wide state.
 */
export const useAppStore = create<AppStore>((set) => ({
  userId: "root",

  userEmail: "root@localhost",

  userPlan: "free",

  billingActive: BILLING_ENABLED,

  emailVerificationEnabled: false,

  emailVerified: true,

  setUserId: (userId) => set({ userId }),

  setUserEmail: (userEmail) => set({ userEmail }),

  setUserPlan: (userPlan) => set({ userPlan }),

  setBillingActive: (billingActive) => set({ billingActive }),

  setEmailVerificationEnabled: (emailVerificationEnabled) => set({ emailVerificationEnabled }),

  setEmailVerified: (emailVerified) => set({ emailVerified }),
}))
