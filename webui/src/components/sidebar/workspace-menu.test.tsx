import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/sidebar", () => ({ SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock("./home", () => ({ HomeMenuItem: () => <span>Home</span> }))
vi.mock("./board", () => ({ DashboardMenuItem: () => <span>Dashboard</span> }))
vi.mock("./image-history", () => ({ ImageHistoryMenuItem: () => <span>AI image history</span> }))

import { WorkspaceMenu } from "./workspace-menu"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true


describe("WorkspaceMenu", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })


  it("shows image history only to signed-in users", () => {
    act(() => root.render(<WorkspaceMenu signedIn={false} />))
    expect(container.textContent).toBe("Home")

    act(() => root.render(<WorkspaceMenu signedIn />))
    expect(container.textContent).toContain("Dashboard")
    expect(container.textContent).toContain("AI image history")
  })
})
