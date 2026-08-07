// Tests for the unified BoardsHome dashboard.
//
// Mirrors the harness pattern (no @testing-library/react): mount with vanilla
// `react-dom/client` under `act`, mocking the data hooks + card leaves via
// hoisted mutable state. We assert the group behaviour — signed-out shows the
// on-device boards plus a sign-in CTA under "Synced"; signed-in fills "Synced"
// with boards — and that each group renders one card per partitioned board.

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BoardMeta } from "@/features/board/model"
import type { BoardListItem } from "@/features/board/api/list-boards"


const state = vi.hoisted(() => ({
  userId: "" as string,
  localBoards: [] as BoardMeta[],
  ready: true,
  syncedBoards: undefined as BoardListItem[] | undefined,
  isLoading: false,
}))

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }))
vi.mock("@/store", () => ({
  useAppStore: (sel: (s: { userId: string }) => unknown) => sel({ userId: state.userId }),
}))
vi.mock("@/features/agent/components/chat/welcome-message", () => ({
  ThemedWelcome: () => null,
}))
vi.mock("../api/list-boards", () => ({
  useListBoards: () => ({ data: state.syncedBoards, isLoading: state.isLoading }),
}))
vi.mock("../local/use-local-boards", () => ({
  useLocalBoards: () => ({
    boards: state.localBoards,
    ready: state.ready,
    createBoard: vi.fn(),
    deleteBoard: vi.fn(),
    renameBoard: vi.fn(),
    refresh: vi.fn(),
  }),
}))
vi.mock("../local/use-enable-sync", () => ({
  useEnableSync: () => ({ enableSync: vi.fn(), pendingId: null }),
}))
vi.mock("../components/board-card", () => ({
  BoardCard: () => <div data-testid="synced-card" />,
  NewBoardCard: () => <div data-testid="new-synced" />,
}))
vi.mock("../local/local-dashboard", () => ({
  LocalBoardCard: () => <div data-testid="local-card" />,
  NewLocalBoardCard: () => <div data-testid="new-local" />,
}))


import { BoardsHome } from "./boards-home"


const local = (id: string): BoardMeta => ({
  id, title: id, kind: "local-only", visibility: "private", createdAt: 1, updatedAt: 1,
})

const synced = (uid: string): BoardListItem => ({
  uid, type: "graph", readonly: false, visibility: "private", createdAt: "2024-01-01T00:00:00Z", role: "owner",
})


let container: HTMLElement
let root: Root


const render = (): void => {
  act(() => {
    root = createRoot(container)
    root.render(<BoardsHome />)
  })
}

const headings = (): string[] =>
  [...container.querySelectorAll("h3")].map((h) => h.textContent ?? "")

const count = (testid: string): number =>
  container.querySelectorAll(`[data-testid="${testid}"]`).length


describe("BoardsHome", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    state.userId = ""
    state.localBoards = []
    state.ready = true
    state.syncedBoards = undefined
    state.isLoading = false
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("signed out (root sentinel): on-device boards + a sign-in CTA under Synced", () => {
    state.userId = "root" // the real logged-out value — truthy, so a naive !!userId would leak
    state.localBoards = [local("a"), local("b")]
    render()
    // Synced group still renders (reveals the feature), but with the CTA — no boards.
    expect(headings()).toEqual(["On this device", "Synced"])
    expect(count("local-card")).toBe(2)
    expect(count("new-local")).toBe(1)
    expect(count("synced-card")).toBe(0)
    expect(container.textContent).toContain("Sync & share your boards")
  })

  it("signed in: renders both groups, deduped by id", () => {
    state.userId = "u1"
    state.localBoards = [local("a"), local("shared")]
    state.syncedBoards = [synced("shared"), synced("s2")]
    render()
    expect(headings()).toEqual(["On this device", "Synced"])
    // "shared" is in both lists → shown once under Synced, dropped on-device.
    expect(count("local-card")).toBe(1)
    expect(count("synced-card")).toBe(2)
    // No direct synced creation — synced boards come from promotion only.
    expect(count("new-synced")).toBe(0)
  })
})
