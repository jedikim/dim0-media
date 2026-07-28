import { beforeEach, describe, expect, it } from "vitest"
import { asNodeId } from "@canvas-harness/core"
import { addNode, resetIdb } from "@/test/canvas"
import { openBoard } from "./open-board"


beforeEach(() => {
  resetIdb()
})


describe("openBoard", () => {
  it("edits survive close + reopen", async () => {
    const a = await openBoard("b")
    addNode(a.store, "n1", "hi")
    await a.close()

    const b = await openBoard("b")
    expect(b.store.getNode(asNodeId("n1"))).toBeDefined()
    expect(b.store.getAllNodes()).toHaveLength(1)
    await b.close()
  })


  it("each open mints a fresh clientId (batch-id uniqueness rule)", async () => {
    const a = await openBoard("b")
    const first = a.store.clientId
    addNode(a.store, "n1")
    await a.close()

    const b = await openBoard("b")
    expect(b.store.clientId).not.toBe(first)
    // and an edit after reopen still persists (no false dedupe)
    b.store.removeNode(asNodeId("n1"))
    await b.close()

    const c = await openBoard("b")
    expect(c.store.getAllNodes()).toHaveLength(0)
    await c.close()
  })


  it("opens an empty board with no account / no network", async () => {
    const a = await openBoard("fresh")
    expect(a.store.getAllNodes()).toHaveLength(0)
    await a.close()
  })
})
