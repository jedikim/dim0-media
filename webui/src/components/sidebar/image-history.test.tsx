import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const mocks = vi.hoisted(() => ({ navigate: vi.fn(), pathname: "/image-history" }))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) => (
    select({ location: { pathname: mocks.pathname } })
  ),
}))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, onClick, isActive }: { children: React.ReactNode, onClick: () => void, isActive: boolean }) => (
    <button data-active={isActive} onClick={onClick}>{children}</button>
  ),
}))
vi.mock("@/components/icons", () => ({ ImageGenerationIcon: () => <span data-icon="history" /> }))

import { ImageHistoryMenuItem } from "./image-history"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true


describe("ImageHistoryMenuItem", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.navigate.mockReset()
    mocks.pathname = "/image-history"
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })


  it("renders the signed-in workspace entry and navigates to the protected route", () => {
    act(() => root.render(<ImageHistoryMenuItem />))
    const button = container.querySelector("button")
    expect(button?.textContent).toContain("AI 이미지 기록")
    expect(button?.dataset.active).toBe("true")
    act(() => button?.click())
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/image-history" })
  })
})
