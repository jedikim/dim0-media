import { describe, expect, it } from "vitest"
import { wrapWithMessageContext } from "./message-context"


describe("wrapWithMessageContext", () => {
  it("wraps the prompt in a <MessageContext> envelope (mirrors the backend)", () => {
    const ctx = "<SelectedNote>\nNoteId: n1\nTitle: A\n</SelectedNote>"
    expect(wrapWithMessageContext("summarize this", ctx)).toBe(
      `<MessageContext>\n\n${ctx}\n\n</MessageContext>\n\nsummarize this`,
    )
  })

  it("returns the bare prompt when context is missing or blank", () => {
    expect(wrapWithMessageContext("hi")).toBe("hi")
    expect(wrapWithMessageContext("hi", "")).toBe("hi")
    expect(wrapWithMessageContext("hi", "   ")).toBe("hi")
  })
})
