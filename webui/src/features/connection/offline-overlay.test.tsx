import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const state = vi.hoisted(() => ({
  status: "online" as "online" | "offline",
  boardOffline: undefined as boolean | undefined,
}))
vi.mock("./connection-state", () => ({
  useConnectionStatus: () => state.status,
}))
vi.mock("@/features/board/api/board-offline-status", () => ({
  useBoardOfflineStatus: () => ({ data: state.boardOffline }),
}))


import { OfflineOverlay } from "./offline-overlay"


let container: HTMLElement
let root: Root

const render = (boardId: string | null): void => {
  act(() => {
    root = createRoot(container)
    root.render(<OfflineOverlay boardId={boardId} />)
  })
}

const overlay = (): Element | null => container.querySelector("[role='alertdialog']")


describe("OfflineOverlay", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    state.status = "online"
    state.boardOffline = undefined
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("renders nothing while online", () => {
    render("b")
    expect(overlay()).toBeNull()
  })

  it("offline on a non-board route → blocks with the generic server message", () => {
    state.status = "offline"
    render(null)
    expect(overlay()).not.toBeNull()
    expect(container.textContent).toContain("Can't reach the Dim0 server")
  })

  it("offline on an offline-available board → does not block", () => {
    state.status = "offline"
    state.boardOffline = true
    render("b")
    expect(overlay()).toBeNull()
  })

  it("offline on an undownloaded board → blocks with the board-specific message", () => {
    state.status = "offline"
    state.boardOffline = false
    render("b")
    expect(overlay()).not.toBeNull()
    expect(container.textContent).toContain("isn't available offline")
  })

  it("offline while the board status is still resolving → does not flash the block", () => {
    state.status = "offline"
    state.boardOffline = undefined
    render("b")
    expect(overlay()).toBeNull()
  })
})
