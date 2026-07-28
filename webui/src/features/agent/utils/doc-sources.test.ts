import { describe, expect, it } from "vitest"
import type { AgentResponse, ReasoningStep, ToolCallStep } from "../types/stream"
import type { DocSearchOutput, ToolOutput } from "../types/tool-outputs"
import { extractDocSources, linkifyDocTitles, type DocSource } from "./doc-sources"


const docStep = (refs: DocSearchOutput["references"]): ToolCallStep => ({
  type: "tool_call",
  id: `s-${refs.map((r) => r.chunkId).join("-")}`,
  name: "doc_search",
  thought: "",
  output: { type: "doc_search", references: refs },
  state: "completed",
  eventMessages: [],
})


const answer = (steps: ReasoningStep[]): AgentResponse => ({ steps })
const ref = (chunkId: string, docId: string, docTitle: string, text: string) => ({ chunkId, docId, docTitle, text })


describe("extractDocSources", () => {
  it("returns [] when there are no doc_search steps", () => {
    const textStep: ReasoningStep = { type: "reasoning_step", id: "t", reasoning: "", message: "hi" }
    expect(extractDocSources(answer([textStep]))).toEqual([])
  })

  it("collects distinct docs in first-seen order with their passages", () => {
    const out = extractDocSources(
      answer([
        docStep([ref("A#0", "A", "Report.pdf", "revenue grew"), ref("B#0", "B", "Bio.pdf", "photosynthesis")]),
      ]),
    )
    expect(out.map((s) => s.docId)).toEqual(["A", "B"])
    expect(out[0]).toEqual({ docId: "A", docTitle: "Report.pdf", passages: ["revenue grew"] })
  })

  it("merges the same docId across refs/steps and dedupes passages", () => {
    const out = extractDocSources(
      answer([
        docStep([ref("A#0", "A", "Report.pdf", "one"), ref("A#1", "A", "Report.pdf", "two")]),
        docStep([ref("A#0", "A", "Report.pdf", "one")]), // duplicate passage across a 2nd call
      ]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].passages).toEqual(["one", "two"])
  })

  it("keeps same-title-but-different-docId documents separate (unique key = docId)", () => {
    const out = extractDocSources(
      answer([docStep([ref("A#0", "A", "report.pdf", "x"), ref("B#0", "B", "report.pdf", "y")])]),
    )
    expect(out.map((s) => s.docId)).toEqual(["A", "B"])
  })

  it("ignores non-doc_search steps, string outputs, and refs with no docId", () => {
    const webStep = {
      type: "tool_call",
      id: "w",
      name: "web_search",
      thought: "",
      output: { type: "web_search", answer: "", searchResults: [] } as ToolOutput,
      state: "completed",
      eventMessages: [],
    } as ToolCallStep
    const stringStep = { ...docStep([]), output: "raw string" as ToolOutput } as ToolCallStep
    const out = extractDocSources(
      answer([webStep, stringStep, docStep([ref("A#0", "A", "R.pdf", "keep"), ref("x", "", "No.pdf", "drop")])]),
    )
    expect(out.map((s) => s.docId)).toEqual(["A"])
  })
})


describe("linkifyDocTitles", () => {
  const src = (docId: string, docTitle: string): DocSource => ({ docId, docTitle, passages: [] })
  const MID = "m1" // message id — namespaces the anchor

  it("wraps an exact title occurrence in a link to its per-message anchor", () => {
    expect(linkifyDocTitles("See Report.pdf for details.", [src("A", "Report.pdf")], MID)).toBe(
      "See [Report.pdf](#doc-m1-A) for details.",
    )
  })

  it("namespaces the anchor by message id (no cross-message collision)", () => {
    expect(linkifyDocTitles("Report.pdf", [src("A", "Report.pdf")], "m2")).toBe(
      "[Report.pdf](#doc-m2-A)",
    )
  })

  it("wraps every occurrence", () => {
    expect(linkifyDocTitles("Report.pdf and again Report.pdf", [src("A", "Report.pdf")], MID)).toBe(
      "[Report.pdf](#doc-m1-A) and again [Report.pdf](#doc-m1-A)",
    )
  })

  it("does not match a substring inside a larger word", () => {
    expect(linkifyDocTitles("mynotes.pdf and notes.pdfx", [src("A", "notes.pdf")], MID)).toBe(
      "mynotes.pdf and notes.pdfx",
    )
  })

  it("prefers the longest title so a contained title isn't half-matched", () => {
    const out = linkifyDocTitles("Report v2.pdf beats Report", [src("A", "Report"), src("B", "Report v2.pdf")], MID)
    expect(out).toContain("[Report v2.pdf](#doc-m1-B)")
    expect(out).toContain("beats [Report](#doc-m1-A)")
    expect(out).not.toContain("[Report](#doc-m1-A) v2.pdf") // the long title wasn't split
  })

  it("does not double-wrap a title already inside a markdown link", () => {
    const already = "[Report.pdf](#doc-m1-A)"
    expect(linkifyDocTitles(already, [src("A", "Report.pdf")], MID)).toBe(already)
  })

  it("handles regex-special characters in the title", () => {
    expect(linkifyDocTitles("open a+b (1).pdf now", [src("A", "a+b (1).pdf")], MID)).toBe(
      "open [a+b (1).pdf](#doc-m1-A) now",
    )
  })

  it("escapes markdown-active chars in the emitted label", () => {
    // Title "a*b_c.pdf" must render literally, not italicize — label is escaped.
    expect(linkifyDocTitles("see a*b_c.pdf here", [src("A", "a*b_c.pdf")], MID)).toBe(
      "see [a\\*b\\_c.pdf](#doc-m1-A) here",
    )
  })

  it("neutralizes HTML metacharacters in the emitted label (no raw HTML injection)", () => {
    // A malicious file name carrying raw HTML must render as literal text, not
    // reach the markdown renderer as active markup.
    const title = "<img src=x onerror=alert(1)>.pdf"
    const out = linkifyDocTitles(`cite ${title} now`, [src("A", title)], MID)
    expect(out).toBe("cite [&lt;img src=x onerror=alert(1)&gt;.pdf](#doc-m1-A) now")
    expect(out).not.toContain("<img")
  })

  it("leaves a plain title's label untouched (no spurious entity encoding)", () => {
    expect(linkifyDocTitles("see Q3 Report.pdf here", [src("A", "Q3 Report.pdf")], MID)).toBe(
      "see [Q3 Report.pdf](#doc-m1-A) here",
    )
  })

  it("links a title at the very start of the text (leading boundary via ^)", () => {
    expect(linkifyDocTitles("notes.pdf is the source", [src("A", "notes.pdf")], MID)).toBe(
      "[notes.pdf](#doc-m1-A) is the source",
    )
  })

  it("skips a title containing brackets (would break the emitted link label)", () => {
    const title = "weird [draft].pdf"
    expect(linkifyDocTitles(`see ${title} here`, [src("A", title)], MID)).toBe(`see ${title} here`)
  })

  it("returns the markdown unchanged when there are no titled sources", () => {
    expect(linkifyDocTitles("nothing to link", [], MID)).toBe("nothing to link")
    expect(linkifyDocTitles("x", [src("A", "   ")], MID)).toBe("x")
  })
})
