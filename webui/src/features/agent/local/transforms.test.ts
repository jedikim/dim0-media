import { describe, expect, it } from "vitest"
import { transformSystemPrompt, translateSystemPrompt, type MindmapTransformKind } from "./transforms"


describe("transformSystemPrompt", () => {
  const kinds: MindmapTransformKind[] = ["mapify", "schemify", "summify", "quizify"]

  it("returns a distinct, tool-oriented prompt for every mindmap kind", () => {
    const prompts = kinds.map(transformSystemPrompt)
    for (const p of prompts) {
      expect(p.length).toBeGreaterThan(20)
      expect(p).toContain("write_note") // must instruct tool use, not prose
      expect(p).toContain("link_notes")
    }
    expect(new Set(prompts).size).toBe(kinds.length) // each kind is distinct
  })
})


describe("translateSystemPrompt", () => {
  it("names the target language and asks for translation-only output", () => {
    const p = translateSystemPrompt("French")
    expect(p).toContain("French")
    expect(p.toLowerCase()).toContain("translat")
  })
})
