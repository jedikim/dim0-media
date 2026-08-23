import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ImageHistoryItem,
  ImageHistorySummary,
} from "../api/image-history"


const mocks = vi.hoisted(() => ({
  useSummary: vi.fn(),
  usePages: vi.fn(),
  useHistoryImage: vi.fn(),
  fetchNextPage: vi.fn(),
  refetchSummary: vi.fn(),
  refetchPages: vi.fn(),
}))

vi.mock("../api/image-history", () => ({
  useImageHistorySummary: mocks.useSummary,
  useImageHistoryPages: mocks.usePages,
}))
vi.mock("../hooks/use-history-image", () => ({ useHistoryImage: mocks.useHistoryImage }))
vi.mock("@/hooks/use-check-ele-in-view", () => ({
  useCheckEleInView: () => ({ ref: vi.fn(), inView: true }),
}))

import { ImageHistoryScreen } from "./image-history-screen"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true


const metrics = {
  attempt_count: 2,
  priced_attempt_count: 1,
  cost_unreported_attempt_count: 1,
  known_cost_usd: "0.0500000000",
  usage: {
    input_units: 5,
    output_units: 7,
    total_units: 12,
    generated_images: 1,
  },
}


const summary: ImageHistorySummary = {
  overall: {
    ...metrics,
    generation_count: 4,
    succeeded_count: 1,
    failed_count: 1,
    active_count: 2,
  },
  users: [
    {
      user: { uid: "alice-uid-long", username: "alice", name: "Alice" },
      ...metrics,
      generation_count: 2,
      succeeded_count: 1,
      failed_count: 1,
      active_count: 0,
    },
    {
      user: { uid: "bob-uid-long", username: "bob", name: null },
      ...metrics,
      known_cost_usd: null,
      generation_count: 2,
      succeeded_count: 0,
      failed_count: 0,
      active_count: 2,
    },
  ],
}


const item = (
  uid: string,
  status: ImageHistoryItem["status"],
  board: ImageHistoryItem["board"],
): ImageHistoryItem => ({
  generation_uid: uid,
  user: { uid: "alice-uid-long", username: "alice", name: "Alice" },
  board,
  provider: "openrouter",
  model_id: "x-ai/grok-imagine-image-2.0",
  prompt: "A complete private prompt that remains fully visible to authenticated users",
  parameters: { aspect_ratio: "1:1", resolution: "1K", quality: "low", output_count: 1 },
  status,
  started_at: "2026-08-23T01:00:00Z",
  completed_at: status === "succeeded" || status === "failed" ? "2026-08-23T01:00:01Z" : null,
  error_code: status === "failed" || status === "retryable" ? "safe_failure" : null,
  error_message: status === "failed" || status === "retryable" ? "Stored safe failure" : null,
  output: status === "succeeded" ? {
    asset_uid: `asset-${uid}`,
    mime_type: "image/png",
    width: 8,
    height: 6,
    content_url: `/image-history/${uid}/assets/asset-${uid}/content`,
  } : null,
  references: status === "succeeded" ? [0, 1].map((ordinal) => ({
    ordinal,
    asset_uid: "duplicate-reference",
    mime_type: "image/png",
    width: 8,
    height: 6,
    content_url: `/image-history/${uid}/assets/duplicate-reference/content`,
  })) : [],
  ...metrics,
})


const items = [
  item("a".repeat(32), "succeeded", { uid: "board-a", name: "Private board", deleted: false }),
  item("b".repeat(32), "retryable", { uid: "board-b", name: null, deleted: false }),
  item("c".repeat(32), "started", { uid: "board-c", name: null, deleted: false }),
  item("d".repeat(32), "failed", { uid: "board-d", name: null, deleted: true }),
]


describe("ImageHistoryScreen", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.fetchNextPage.mockReset()
    mocks.refetchSummary.mockReset()
    mocks.refetchPages.mockReset()
    mocks.useHistoryImage.mockReset().mockReturnValue({ url: "blob:thumbnail", failed: false })
    mocks.useSummary.mockReset().mockReturnValue({
      data: summary,
      isError: false,
      refetch: mocks.refetchSummary,
    })
    mocks.usePages.mockReset().mockReturnValue({
      data: { pages: [{ items, next_cursor: "next" }], pageParams: [null] },
      isPending: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: mocks.fetchNextPage,
      refetch: mocks.refetchPages,
    })
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })


  const render = (): void => {
    act(() => root.render(<ImageHistoryScreen />))
  }


  const select = (label: string, value: string): void => {
    const element = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
    setter?.call(element, value)
    act(() => element.dispatchEvent(new Event("change", { bubbles: true })))
  }


  it("renders global policy, summaries, complete records, statuses, and ordered thumbnails", () => {
    render()

    expect(container.textContent).toContain("AI 이미지 기록")
    expect(container.textContent).toContain("모든 사용자의 이미지 생성 기록과 provider-reported 비용 및 사용량입니다.")
    expect(container.textContent).toContain("private board의 이름·프롬프트·결과")
    expect(container.textContent).toContain("opt-out")
    expect(container.textContent).toContain("Alice · @alice")
    expect(container.textContent).toContain("@bob")
    expect(container.textContent).toContain("$0.0500 · 비용 미보고 1회")
    expect(container.textContent).toContain("Provider-reported usage")
    expect(container.textContent).toContain("generated images 1")
    expect(container.querySelectorAll("[data-generation-status]")).toHaveLength(4)
    expect(container.textContent).toContain("Private board")
    expect(container.textContent).toContain("이름 없는 보드")
    expect(container.textContent).toContain("삭제된 보드")
    expect(container.textContent).toContain("A complete private prompt that remains fully visible")
    expect(container.textContent).toContain("전체 보기")
    expect(container.textContent).toContain("x-ai/grok-imagine-image-2.0")
    expect(container.textContent).toContain("비율 1:1 · 해상도 1K · 품질 low · 결과 1")
    expect(container.querySelector('img[alt="생성 결과"]')).not.toBeNull()
    expect(container.querySelectorAll('img[alt^="참조 이미지"]')).toHaveLength(2)
    expect(container.textContent).toContain("Stored safe failure")
    expect(mocks.useHistoryImage).toHaveBeenCalledWith("a".repeat(32), "duplicate-reference", true)
  })


  it("changes filter query identity, resets cursor pages, and loads more explicitly", () => {
    render()
    expect(mocks.usePages).toHaveBeenLastCalledWith({ userUid: null, status: null })

    select("사용자 필터", "alice-uid-long")
    expect(mocks.usePages).toHaveBeenLastCalledWith({ userUid: "alice-uid-long", status: null })

    select("상태 필터", "failed")
    expect(mocks.usePages).toHaveBeenLastCalledWith({ userUid: "alice-uid-long", status: "failed" })

    const more = [...container.querySelectorAll("button")].find((button) => button.textContent === "더 보기")
    act(() => more?.click())
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)
  })


  it("renders loading, empty, terminal-page, error retry, and thumbnail failure states", () => {
    mocks.useSummary.mockReturnValue({ data: undefined, isError: false, refetch: mocks.refetchSummary })
    mocks.usePages.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: mocks.fetchNextPage,
      refetch: mocks.refetchPages,
    })
    render()
    expect(container.textContent).toContain("기록을 불러오는 중…")

    mocks.useSummary.mockReturnValue({ data: summary, isError: false, refetch: mocks.refetchSummary })
    mocks.usePages.mockReturnValue({
      data: { pages: [{ items: [], next_cursor: null }], pageParams: [null] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: mocks.fetchNextPage,
      refetch: mocks.refetchPages,
    })
    render()
    expect(container.textContent).toContain("아직 이미지 생성 기록이 없습니다.")
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "더 보기")).toBe(false)

    mocks.useHistoryImage.mockReturnValue({ url: null, failed: true })
    mocks.useSummary.mockReturnValue({ data: summary, isError: true, refetch: mocks.refetchSummary })
    mocks.usePages.mockReturnValue({
      data: { pages: [{ items: [items[0]], next_cursor: null }], pageParams: [null] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: mocks.fetchNextPage,
      refetch: mocks.refetchPages,
    })
    render()
    expect(container.textContent).toContain("이미지를 불러올 수 없음")
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "다시 시도")
    act(() => retry?.click())
    expect(mocks.refetchSummary).toHaveBeenCalledTimes(1)
    expect(mocks.refetchPages).toHaveBeenCalledTimes(1)
  })
})
