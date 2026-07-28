import { describe, expect, it } from "vitest"
import type { AgentResponse, ToolCallStep, ToolName } from "../types/stream"
import type { WebSearchOutput } from "../types/tool-outputs"
import { extractAnswerWebSources } from "./url"


const toolStep = (name: ToolName, output: WebSearchOutput | string): ToolCallStep => ({
  type: "tool_call",
  id: `s-${name}`,
  name,
  thought: "",
  output,
  state: "completed",
  eventMessages: [],
})


const source = (url: string, title: string): WebSearchOutput => ({
  type: "web_search",
  answer: "",
  searchResults: [{ type: "url", url, title }],
})


describe("extractAnswerWebSources", () => {
  it("aggregates and dedupes sources across web_search AND fetch steps", () => {
    const answer: AgentResponse = {
      steps: [
        toolStep("web_search", {
          type: "web_search",
          answer: "",
          searchResults: [
            { type: "url", url: "https://a.com", title: "A" },
            { type: "url", url: "https://b.com", title: "B" },
          ],
        }),
        toolStep("fetch", source("https://c.com", "C")),
        toolStep("fetch", source("https://a.com", "A dup")), // deduped by url
      ],
    }
    expect(extractAnswerWebSources(answer).map((s) => s.url)).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ])
  })


  it("ignores steps whose output is a plain string (no structured sources)", () => {
    const answer: AgentResponse = { steps: [toolStep("fetch", "<UrlContent url=...>plain</UrlContent>")] }
    expect(extractAnswerWebSources(answer)).toEqual([])
  })
})
