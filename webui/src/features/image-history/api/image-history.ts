import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query"

import { apiFetch } from "@/api"


export type ImageHistoryStatus = "started" | "retryable" | "succeeded" | "failed"


export type ImageHistoryUser = {
  uid: string
  username: string
  name: string | null
}


export type ImageHistoryUsage = {
  input_units: number | null
  output_units: number | null
  total_units: number | null
  generated_images: number | null
}


export type ImageHistoryMetrics = {
  attempt_count: number
  priced_attempt_count: number
  cost_unreported_attempt_count: number
  known_cost_usd: string | null
  usage: ImageHistoryUsage
}


export type ImageHistorySummaryMetrics = ImageHistoryMetrics & {
  generation_count: number
  succeeded_count: number
  failed_count: number
  active_count: number
}


export type ImageHistorySummary = {
  overall: ImageHistorySummaryMetrics
  users: Array<ImageHistorySummaryMetrics & { user: ImageHistoryUser }>
}


export type ImageHistoryAsset = {
  asset_uid: string
  mime_type: string
  width: number
  height: number
  content_url: string
}


export type ImageHistoryItem = ImageHistoryMetrics & {
  generation_uid: string
  user: ImageHistoryUser
  board: {
    uid: string
    name: string | null
    deleted: boolean
  }
  provider: string
  model_id: string
  prompt: string
  parameters: {
    aspect_ratio?: string | null
    resolution?: string | null
    quality?: string | null
    output_count?: number
  }
  status: ImageHistoryStatus
  started_at: string
  completed_at: string | null
  error_code: string | null
  error_message: string | null
  output: ImageHistoryAsset | null
  references: Array<ImageHistoryAsset & { ordinal: number }>
}


export type ImageHistoryPage = {
  items: ImageHistoryItem[]
  next_cursor: string | null
}


export type ImageHistoryFilters = {
  userUid: string | null
  status: ImageHistoryStatus | null
}


export const IMAGE_HISTORY_PAGE_SIZE = 25


/** Read the global and per-user provider-reported image usage summary. */
export function getImageHistorySummary(signal?: AbortSignal): Promise<ImageHistorySummary> {
  return apiFetch<ImageHistorySummary>({ path: "/image-history/summary", signal })
}


/** Read one filtered cursor page while forwarding cancellation to the API. */
export function getImageHistoryPage(
  filters: ImageHistoryFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ImageHistoryPage> {
  return apiFetch<ImageHistoryPage>({
    path: "/image-history",
    params: {
      limit: IMAGE_HISTORY_PAGE_SIZE,
      cursor,
      user_uid: filters.userUid,
      status: filters.status,
    },
    signal,
  })
}


/** Fetch generation-scoped history bytes through the authenticated API client. */
export function fetchImageHistoryAssetBlob(
  generationUid: string,
  assetUid: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return apiFetch<Blob>({
    path: `/image-history/${encodeURIComponent(generationUid)}/assets/${encodeURIComponent(assetUid)}/content`,
    responseType: "blob",
    signal,
  })
}


/** Query the global summary with stale-request cancellation. */
export function useImageHistorySummary() {
  return useQuery({
    queryKey: ["imageHistory", "summary"],
    queryFn: ({ signal }) => getImageHistorySummary(signal),
  })
}


/** Query cursor pages; changing either filter starts a fresh page chain. */
export function useImageHistoryPages(filters: ImageHistoryFilters) {
  return useInfiniteQuery<
    ImageHistoryPage,
    Error,
    InfiniteData<ImageHistoryPage>,
    [string, string, string, string],
    string | null
  >({
    queryKey: ["imageHistory", "pages", filters.userUid ?? "all", filters.status ?? "all"],
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) => getImageHistoryPage(filters, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  })
}
