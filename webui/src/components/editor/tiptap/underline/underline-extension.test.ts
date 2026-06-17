// Markdown round-trip tests for the underline mark.
//
// What we lock in here is the contract the editor depends on: a user's
// Ctrl+U edit survives `getMarkdown()` → DB → next page-load via
// `setContent(markdown)`. Before this extension the underline mark
// silently dropped on round-trip (tiptap-markdown had no parser rule
// for Tiptap's bundled `++…++` serializer); these tests guard the new
// `<u>…</u>` cycle.

import { Editor } from "@tiptap/core"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"
import { Bold } from "@tiptap/extension-bold"
import { Markdown } from "tiptap-markdown"
import { describe, expect, it } from "vitest"

import { UnderlineMarkdown } from "./underline-extension"


/**
 * Build a minimal Tiptap editor with just the underline + markdown
 * extensions. We don't want StarterKit here — it would pull in the
 * stock underline (which we're replacing) and a pile of unrelated
 * marks, polluting the test surface.
 */
function makeEditor(): Editor {
  return new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      UnderlineMarkdown,
      Markdown.configure({ html: false }),
    ],
  })
}


/** `editor.storage.markdown` has a `getMarkdown()` method at runtime; type it locally. */
type MarkdownStorage = { getMarkdown(): string }


function toMarkdown(editor: Editor): string {
  const storage = (editor.storage as unknown as Record<string, unknown>).markdown
  return (storage as MarkdownStorage).getMarkdown()
}


describe("UnderlineMarkdown — round trip", () => {
  it("parses <u>…</u> markdown back into an underline mark", () => {
    const editor = makeEditor()
    editor.commands.setContent("Some <u>underlined</u> text.")
    // After parsing, the editor's HTML should carry a <u> wrapper —
    // proves the mark was applied (not just kept as plain text).
    expect(editor.getHTML()).toContain("<u>underlined</u>")
    editor.destroy()
  })


  it("round-trips lossless — markdown → editor → markdown", () => {
    const editor = makeEditor()
    const md = "Underlines like <u>this</u> survive a full cycle."
    editor.commands.setContent(md)
    expect(toMarkdown(editor)).toBe(md)
    editor.destroy()
  })


  it("survives combining with bold inside the underline", () => {
    const editor = makeEditor()
    // Bold AND underline on the same span. The marks should both
    // survive a round-trip, even though tiptap-markdown may serialize
    // them in either nesting order (`<u>**x**</u>` or `**<u>x</u>**` —
    // semantically identical) depending on mark rank in the schema.
    editor.commands.setContent("Mix <u>**bold underline**</u> here.")
    const out = toMarkdown(editor)
    expect(out).toContain("<u>")
    expect(out).toContain("</u>")
    expect(out.match(/\*\*/g)?.length).toBe(2) // bold open + close
    expect(out).toContain("bold underline")
    // The HTML should show both marks applied to the same text.
    const html = editor.getHTML()
    expect(html).toContain("<u>")
    expect(html).toContain("<strong>")
    editor.destroy()
  })


  it("does not match empty or multi-line spans", () => {
    const editor = makeEditor()
    // Empty span — should pass through as literal text (no mark applied).
    editor.commands.setContent("Edge: <u></u> stays literal.")
    expect(editor.getHTML()).not.toContain("<u></u>")

    // Multi-line — markdown-it's inline rules don't span newlines, so
    // this should leave the tags as raw text rather than wrap a
    // paragraph break.
    editor.commands.setContent("Open <u>foo\nbar</u> end.")
    expect(editor.getHTML()).not.toContain("<u>foo")

    editor.destroy()
  })
})
