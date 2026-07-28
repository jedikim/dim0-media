import type { Schema } from "hast-util-sanitize"
import type { Root, Element } from "hast"
import { defaultSchema } from "rehype-sanitize"


// MathML elements emitted by rehype-katex for the accessible (screen-reader)
// math tree. Allowlisted so KaTeX output survives sanitization.
const MATHML_TAGS = [
  "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "ms", "mtext",
  "mspace", "mfrac", "mroot", "msqrt", "msup", "msub", "msubsup", "mover",
  "munder", "munderover", "mtable", "mtr", "mtd", "mlabeledtr", "mpadded",
  "mphantom", "menclose", "mstyle", "mglyph", "merror", "maction",
]


// SVG elements KaTeX emits for stretchy delimiters, sqrt rules and arrows.
const SVG_TAGS = ["svg", "path", "line", "g", "rect", "defs", "use"]


// Inert geometric / presentational attributes used by KaTeX's MathML and SVG
// output. None are script-bearing; event-handler and URL attributes are
// intentionally excluded so the sanitizer still strips them.
const MATH_SVG_ATTRS = [
  "className", "style", "ariaHidden", "xmlns", "encoding", "mathvariant",
  "displaystyle", "scriptlevel", "stretchy", "fence", "accent", "accentunder",
  "columnalign", "columnspacing", "rowalign", "rowspacing", "linethickness",
  "lspace", "rspace", "voffset", "width", "height", "depth", "minsize",
  "maxsize", "mathcolor", "mathbackground", "notation", "separator", "form",
  "largeop", "movablelimits", "symmetric", "viewBox", "preserveAspectRatio",
  "d", "fill", "stroke", "strokeWidth", "transform", "x", "y", "x1", "y1",
  "x2", "y2", "points",
]


/**
 * Sanitization schema for the markdown viewer.
 *
 * Extends hast-util-sanitize's GitHub-style `defaultSchema` so raw HTML parsed
 * by rehype-raw is stripped of script/handler/URL-based XSS vectors while the
 * viewer's intended rich output keeps rendering: KaTeX math (rehype-katex's
 * MathML + styled HTML spans), highlight `<mark>` chips, `#tag` `<span>` chips,
 * `<details>`/`<summary>` toggles and `page://` reference links.
 */
export const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  // defaultSchema rewrites id/name to `user-content-*` (DOM-clobber defense),
  // but it does NOT rewrite matching href fragments — which breaks in-document
  // anchors and GFM footnotes. Empty prefix keeps ids intact so navigation
  // still works; script injection is already blocked by the sanitizer above.
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", ...MATHML_TAGS, ...SVG_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    // Highlight marks carry a validated color: `data-color` themes the named
    // palette, an inline `style` themes custom hex values (see remark-highlight).
    // `style` values are additionally scrubbed by rehypeSafeStyle (below).
    mark: ["dataColor", "style"],
    // KaTeX HTML spans and `#tag` chips rely on class names + inline layout
    // styles; `aria-hidden` marks KaTeX's visual (non-AT) subtree.
    span: ["className", "style", "ariaHidden"],
    ...Object.fromEntries([...MATHML_TAGS, ...SVG_TAGS].map((tag) => [tag, MATH_SVG_ATTRS])),
  },
  protocols: {
    ...defaultSchema.protocols,
    // `page://` renders as an inline PageRefChip; tel/sms are legitimate contact
    // links (kept in sync with markdown-link's SAFE_SCHEMES).
    href: [...(defaultSchema.protocols?.href ?? []), "page", "tel", "sms"],
    // `data:` on <img> is inert (an image can't execute HTML/JS, incl.
    // data:image/svg+xml loaded as an image) — re-allow it so legitimate inline
    // base64 images render. Other data: sinks (iframe/object/a) stay stripped
    // because those tags/attrs aren't allowlisted.
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
}


// CSS declarations that enable clickjacking overlays or off-site beacons even
// without script execution. hast-util-sanitize does NOT sanitize CSS, so we
// scrub inline `style` after sanitization: drop out-of-flow positioning
// (fixed/absolute/sticky), stacking (z-index), and url() / expression() values,
// while preserving the in-flow layout styles KaTeX and highlight marks need.
const isDangerousDecl = (prop: string, value: string): boolean =>
  value.includes("url(") ||
  value.includes("expression(") ||
  prop === "z-index" ||
  (prop === "position" && /\b(?:fixed|absolute|sticky)\b/.test(value))


/** Keep only safe declarations of an inline `style` string. */
export const cleanStyle = (style: string): string =>
  style
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      const i = d.indexOf(":")
      if (i === -1) return false
      const prop = d.slice(0, i).trim().toLowerCase()
      const value = d.slice(i + 1).trim().toLowerCase()
      return !isDangerousDecl(prop, value)
    })
    .join("; ")


/**
 * rehype plugin (runs AFTER rehype-sanitize): scrub the inline `style` attribute
 * on every element, since the sanitizer allowlists `style` but can't inspect CSS
 * values. Closes CSS-only injection (full-viewport overlays, url() beacons).
 */
export const rehypeSafeStyle = () => (tree: Root): Root => {
  const walk = (node: Root | Element): void => {
    if (node.type === "element" && typeof node.properties.style === "string") {
      const cleaned = cleanStyle(node.properties.style)
      if (cleaned) node.properties.style = cleaned
      else delete node.properties.style
    }
    for (const child of node.children) {
      if (child.type === "element") walk(child)
    }
  }
  walk(tree)
  return tree
}
