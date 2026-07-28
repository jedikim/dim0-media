// The `/` front door branches on auth: signed-in → HomePage (chat + dashboard),
// signed-out → the local board dashboard. Verified with stubbed children so we
// assert the branch, not the (heavy) screens themselves.

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const state = vi.hoisted(() => ({ userId: "root" as string }))

vi.mock("@/store", () => ({
  useAppStore: (sel: (s: { userId: string }) => unknown) => sel({ userId: state.userId }),
}))
vi.mock("./home", () => ({ HomePage: () => <div data-testid="home-page" /> }))
vi.mock("@/features/board/screens/boards-home", () => ({
  BoardsHome: () => <div data-testid="boards-home" />,
}))


import { IndexHome } from "./index-home"


let container: HTMLElement
let root: Root

const render = (): void => {
  act(() => {
    root = createRoot(container)
    root.render(<IndexHome />)
  })
}

const has = (testid: string): boolean =>
  container.querySelector(`[data-testid="${testid}"]`) !== null


describe("IndexHome", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    state.userId = "root"
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("signed out (root) → local board dashboard, no chat home", () => {
    state.userId = "root"
    render()
    expect(has("boards-home")).toBe(true)
    expect(has("home-page")).toBe(false)
  })

  it("signed in → full HomePage", () => {
    state.userId = "user-123"
    render()
    expect(has("home-page")).toBe(true)
    expect(has("boards-home")).toBe(false)
  })
})
