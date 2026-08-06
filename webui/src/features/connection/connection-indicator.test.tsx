import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const state = vi.hoisted(() => ({ status: "online" as "online" | "offline" }))
vi.mock("./connection-state", () => ({
  useConnectionStatus: () => state.status,
}))


import { ConnectionIndicator } from "./connection-indicator"


let container: HTMLElement
let root: Root

const render = (): void => {
  act(() => {
    root = createRoot(container)
    root.render(<ConnectionIndicator />)
  })
}

const badge = (): Element | null => container.querySelector("[role='status']")


describe("ConnectionIndicator", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    state.status = "online"
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("renders nothing while online", () => {
    render()
    expect(badge()).toBeNull()
  })

  it("shows an offline badge while offline", () => {
    state.status = "offline"
    render()
    expect(badge()).not.toBeNull()
    expect(container.textContent).toContain("Offline")
  })
})
