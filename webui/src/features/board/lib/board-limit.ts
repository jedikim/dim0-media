import { BILLING_ENABLED } from "@/config/billing"
import type { BillingPlan } from "@/lib/decode-jwt"
import { useAppStore } from "@/store"
import { useListBoards } from "../api/list-boards"


export const FREE_PLAN_BOARD_LIMIT = 10
export const FREE_PLAN_DOCUMENT_LIMIT_PER_BOARD = 1

export const FREE_PLAN_BOARD_LIMIT_TOOLTIP =
  `${FREE_PLAN_BOARD_LIMIT}-board limit reached for free plan. Upgrade to Plus for unlimited limits, or self-host for your own unlimited setup.`
export const FREE_PLAN_DOCUMENT_LIMIT_TOOLTIP =
  "1-document upload limit reached for this board on free plan. Upgrade to Plus for unlimited limits, or self-host for your own unlimited setup."


export function isBoardCreationLimited(plan: BillingPlan, boardCount: number): boolean {
  return BILLING_ENABLED && plan === "free" && boardCount >= FREE_PLAN_BOARD_LIMIT
}


export function isDocumentUploadLimited(plan: BillingPlan, documentCount: number): boolean {
  return BILLING_ENABLED && plan === "free" && documentCount >= FREE_PLAN_DOCUMENT_LIMIT_PER_BOARD
}


/**
 * Reactive variant of `isBoardCreationLimited` for UI gating.
 * Reuses the cached `listBoards` query so it doesn't trigger extra fetches.
 */
export function useIsBoardCreationLimited(): boolean {
  const userId = useAppStore((s) => s.userId)
  const userPlan = useAppStore((s) => s.userPlan)
  const { data: boards = [] } = useListBoards(userId)
  return isBoardCreationLimited(userPlan, boards.length)
}
