import { beforeEach, describe, expect, it } from "vitest"
import { resetIdb } from "@/test/canvas"
import { fetchMiniAppState, saveMiniAppState } from "./state-client"


beforeEach(() => resetIdb())


describe("mini-app state (IndexedDB)", () => {
  it("round-trips per-note state", async () => {
    await saveMiniAppState("n1", { count: 3 })
    expect(await fetchMiniAppState("n1")).toEqual({ count: 3 })
  })


  it("returns undefined for an unknown note", async () => {
    expect(await fetchMiniAppState("ghost")).toBeUndefined()
  })


  it("overwrites previous state and isolates notes", async () => {
    await saveMiniAppState("n1", { v: 1 })
    await saveMiniAppState("n1", { v: 2 })
    await saveMiniAppState("n2", { other: true })
    expect(await fetchMiniAppState("n1")).toEqual({ v: 2 })
    expect(await fetchMiniAppState("n2")).toEqual({ other: true })
  })
})
