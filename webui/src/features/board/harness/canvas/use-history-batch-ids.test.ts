import { describe, expect, it } from "vitest"
import type { OpBatch } from "@canvas-harness/core"
import { addNode, freshStore } from "@/test/canvas"
import { installHistoryBatchIds } from "./use-history-batch-ids"


describe("installHistoryBatchIds", () => {
  it("gives undo and redo fresh unique ids (redo no longer reuses the original)", () => {
    const store = freshStore("c")
    installHistoryBatchIds(store) // must be the first subscriber
    const seen: OpBatch[] = []
    store.subscribe("change", (b) => seen.push(b))

    addNode(store, "n1", "hello")
    const addId = seen[0].id

    store.undo()
    store.redo()

    const undoId = seen[1].id
    const redoId = seen[2].id
    expect(seen[1].origin).toBe("history")
    expect(seen[2].origin).toBe("history")
    // Redo would reuse addId without the rewrite → collides with batch-id dedup.
    expect(redoId).not.toBe(addId)
    expect(redoId).not.toBe(undoId)
    expect(new Set([addId, undoId, redoId]).size).toBe(3) // all distinct
  })


  it("leaves local (non-history) batch ids untouched", () => {
    const store = freshStore("c")
    installHistoryBatchIds(store)
    const seen: OpBatch[] = []
    store.subscribe("change", (b) => seen.push(b))

    addNode(store, "n1")
    expect(seen[0].origin).toBe("local")
    // A local op keeps whatever id the store assigned (not rewritten).
    expect(seen[0].id).toBeTruthy()
  })
})
