import { describe, expect, it } from "vitest"
import { promoteNavTarget } from "./use-enable-sync"


describe("promoteNavTarget", () => {
  it("targets the synced route when the promoted board is open at /local/$id", () => {
    expect(promoteNavTarget("/local/board-1", "board-1")).toEqual({
      to: "/boards/$id",
      params: { id: "board-1" },
    })
  })

  it("returns null when viewing a different local board (promoted from the sidebar)", () => {
    expect(promoteNavTarget("/local/board-2", "board-1")).toBeNull()
  })

  it("returns null when not on a board route (e.g. the dashboard)", () => {
    expect(promoteNavTarget("/", "board-1")).toBeNull()
    expect(promoteNavTarget("/local", "board-1")).toBeNull()
  })

  it("returns null when the board is already open on the synced route", () => {
    // Already synced → the local route no longer matches, so no re-navigate.
    expect(promoteNavTarget("/boards/board-1", "board-1")).toBeNull()
  })

  it("does not match a board id that is only a path prefix", () => {
    expect(promoteNavTarget("/local/board-1/extra", "board-1")).toBeNull()
  })
})
