import { describe, expect, it } from "vitest"
import { asNodeId } from "@canvas-harness/core"
import type { DimNode } from "@/features/board/model"
import { toSearchRows } from "./notes-search"


const node = (id: string, label?: string, parentId?: string | null, content?: string): DimNode =>
  ({
    id: asNodeId(id),
    content,
    data: { label, parentId, meta: { v: 1, createdAt: 0, updatedAt: 0 } },
  }) as unknown as DimNode


describe("toSearchRows", () => {
  it("uses the label as the title and includes body + id in the filter value", () => {
    const [row] = toSearchRows([node("n1", "Revenue", null, "growth numbers")])
    expect(row.title).toBe("Revenue")
    expect(row.value).toContain("Revenue")
    expect(row.value).toContain("growth numbers")
    expect(row.value).toContain("n1")
  })


  it("falls back to a body snippet, then 'Untitled', when there's no label", () => {
    expect(toSearchRows([node("n1", undefined, null, "some body text")])[0].title).toBe("some body text")
    expect(toSearchRows([node("n2", undefined, null, "")])[0].title).toBe("Untitled")
  })


  it("resolves the folder breadcrumb from the note's layer", () => {
    // f1 (root) › f2 (in f1) › leaf (in f2)
    const nodes = [node("f1", "Alpha", null), node("f2", "Beta", "f1"), node("leaf", "Note", "f2", "body")]
    const rows = toSearchRows(nodes)
    const leaf = rows.find((r) => r.id === "leaf")
    expect(leaf?.crumb).toBe("Alpha / Beta")
    expect(leaf?.parentId).toBe("f2")
  })


  it("gives root-level notes an empty breadcrumb", () => {
    expect(toSearchRows([node("n1", "Top", null)])[0].crumb).toBe("")
  })
})
