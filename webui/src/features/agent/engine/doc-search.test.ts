import { describe, expect, it } from "vitest"
import { DocChunkIndex } from "@/features/board/search/doc-index"
import type { ToolContext } from "./types"
import { makeDocSearchTool } from "./doc-search"


describe("makeDocSearchTool", () => {
  it("is named doc_search and returns the index's matching passages", async () => {
    const index = new DocChunkIndex()
    await index.rebuild([
      { chunkId: "c0", docId: "d1", docTitle: "Report", text: "Q3 revenue grew 20% year over year." },
      { chunkId: "c1", docId: "d1", docTitle: "Report", text: "Headcount stayed flat." },
    ])
    const tool = makeDocSearchTool(index)
    expect(tool.name).toBe("doc_search")

    const out = (await tool.run({ query: "revenue growth" }, {} as ToolContext)) as {
      results: { chunkId: string; docId: string; docTitle: string; text: string }[]
    }
    expect(out.results.length).toBeGreaterThan(0)
    expect(out.results[0]).toMatchObject({ chunkId: "c0", docId: "d1", docTitle: "Report" })
    expect(out.results[0].text).toContain("revenue")
  })

  it("returns an empty result set when nothing is indexed", async () => {
    const out = (await makeDocSearchTool(new DocChunkIndex()).run({ query: "x" }, {} as ToolContext)) as {
      results: unknown[]
    }
    expect(out.results).toEqual([])
  })
})
