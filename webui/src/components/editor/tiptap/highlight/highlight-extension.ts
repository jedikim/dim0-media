import { Highlight } from "@tiptap/extension-highlight"
import { markInputRule } from "@tiptap/core"
import type MarkdownIt from "markdown-it"


/** Named colors that are allowed as the optional prefix in `==color:text==`. */
export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "blue",
  "red",
  "pink",
  "purple",
  "orange",
  "gray",
] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]
const NAMED_COLORS = new Set<string>(HIGHLIGHT_COLORS)
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/


export function isAllowedColor(s: string): boolean {
  return NAMED_COLORS.has(s.toLowerCase()) || HEX_RE.test(s)
}


export function isNamedColor(s: string): boolean {
  return NAMED_COLORS.has(s.toLowerCase())
}


function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}


/**
 * Highlight mark with tiptap-markdown round-trip support.
 *
 * Syntax:
 *   ==text==           → default highlight (yellow / theme)
 *   ==yellow:text==    → named color (allowlist: yellow, green, blue, red,
 *                        pink, purple, orange, gray)
 *   ==#ffeb3b:text==   → hex color (3-8 hex chars, optional alpha)
 *
 * Anything that doesn't match the allowed color forms (e.g. `http:` in
 * `==http://example.com==`) is treated as plain content — no false
 * "color" capture.
 */
export const HighlightMarkdown = Highlight.extend({
  /**
   * Override the `color` attribute's renderHTML so named colors only carry
   * `data-color` (CSS rules take it from there with theme-aware variables).
   * Hex colors keep an inline `style` since CSS can't predefine arbitrary
   * hex values.
   */
  addAttributes() {
    const parent = this.parent?.() ?? {}
    if (!this.options.multicolor) return parent
    return {
      ...parent,
      color: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-color") || el.style.backgroundColor || null,
        renderHTML: (attrs: { color?: string | null }) => {
          if (!attrs.color) return {}
          if (isNamedColor(attrs.color)) {
            return { "data-color": attrs.color.toLowerCase() }
          }
          return {
            "data-color": attrs.color,
            style: `background-color: ${attrs.color}; color: inherit`,
          }
        },
      },
    }
  },

  /**
   * Real-time `==color:text==` input rule. Lets users type the markdown
   * shorthand directly in the editor — no save/reload required to see the
   * highlight applied with the right color.
   */
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)==(?:([a-zA-Z]+|#[0-9a-fA-F]{3,8}):)?([^=\n]+?)==$/,
        type: this.type,
        getAttributes: (match) => {
          const candidate = match[1]
          if (candidate && isAllowedColor(candidate)) return { color: candidate }
          return {}
        },
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs?: { color?: string | null } }) => {
            const color = mark.attrs?.color
            return color ? `==${color}:` : "=="
          },
          close: "==",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup(md: MarkdownIt) {
            md.inline.ruler.after("emphasis", "highlight", (state, silent) => {
              if (state.src.charCodeAt(state.pos) !== 0x3d /* '=' */) return false
              if (state.src.charCodeAt(state.pos + 1) !== 0x3d) return false

              const innerStart = state.pos + 2
              const closeIdx = state.src.indexOf("==", innerStart)
              if (closeIdx === -1) return false

              const inner = state.src.slice(innerStart, closeIdx)
              if (!inner || inner.includes("\n")) return false

              // Try to peel off an optional `color:` prefix. Constrained to
              // a named-color allowlist or a `#hex` so URL-like content
              // (`http://…`) doesn't get mistaken for a color.
              let color: string | null = null
              let content = inner
              const colonIdx = inner.indexOf(":")
              if (colonIdx > 0) {
                const candidate = inner.slice(0, colonIdx)
                if (isAllowedColor(candidate)) {
                  color = candidate
                  content = inner.slice(colonIdx + 1)
                }
              }
              if (!content) return false

              if (!silent) {
                const open = state.push("highlight_open", "mark", 1)
                if (color) {
                  open.attrSet("data-color", color)
                  open.attrSet("style", `background-color: ${color}; color: inherit`)
                }
                const text = state.push("text", "", 0)
                text.content = content
                state.push("highlight_close", "mark", -1)
              }
              state.pos = closeIdx + 2
              return true
            })

            md.renderer.rules.highlight_open = (tokens, idx) => {
              const token = tokens[idx]
              const color = token.attrGet("data-color")
              if (!color) return "<mark>"
              return `<mark data-color="${escapeAttr(color)}" style="background-color: ${escapeAttr(color)}; color: inherit">`
            }
            md.renderer.rules.highlight_close = () => "</mark>"
          },
        },
      },
    }
  },
})
