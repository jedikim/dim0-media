import { describe, expect, it } from "vitest"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import { sanitize } from "hast-util-sanitize"
import { SANITIZE_SCHEMA, cleanStyle, rehypeSafeStyle } from "./sanitize-schema"


// Exercise the schema the way rehype-sanitize applies it (see markdown-view.tsx):
// parse raw HTML → sanitize with SANITIZE_SCHEMA → serialize.
const clean = (html: string): string => toHtml(sanitize(fromHtml(html, { fragment: true }), SANITIZE_SCHEMA))


describe("SANITIZE_SCHEMA — strips XSS vectors", () => {
  it("removes <script>", () => {
    expect(clean("<script>alert(1)</script>")).not.toContain("<script")
  })

  it("removes <iframe> (incl. javascript: src)", () => {
    const out = clean('<iframe src="javascript:alert(1)"></iframe>')
    expect(out).not.toContain("<iframe")
    expect(out).not.toContain("javascript:")
  })

  it("removes <object>/<embed>/<form>", () => {
    const out = clean("<object></object><embed><form></form>")
    expect(out).not.toContain("<object")
    expect(out).not.toContain("<embed")
    expect(out).not.toContain("<form")
  })

  it("strips inline event handlers but can keep the element", () => {
    const out = clean('<img src="x" onerror="alert(1)">')
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("alert(1)")
  })

  it("strips a javascript: href on an anchor (keeps the text)", () => {
    const out = clean('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain("javascript:")
    expect(out).toContain("click")
  })

})


describe("SANITIZE_SCHEMA — no over-stripping of legitimate content", () => {
  it("keeps a data:image URI on an <img> (inert — an image cannot execute)", () => {
    expect(clean('<img src="data:image/png;base64,iVBORw0KGgo=">')).toContain("data:image/png")
  })

  it("does not rewrite in-document anchor ids (clobberPrefix empty)", () => {
    const out = clean('<h2 id="summary">Summary</h2>')
    expect(out).toContain('id="summary"')
    expect(out).not.toContain("user-content")
  })

  it("keeps tel:/sms: hrefs (contact links)", () => {
    expect(clean('<a href="tel:+15551234567">call</a>')).toContain("tel:+15551234567")
    expect(clean('<a href="sms:+15551234567">text</a>')).toContain("sms:+15551234567")
  })
})


describe("cleanStyle — scrubs CSS-injection vectors, keeps layout", () => {
  it("drops fixed/absolute/sticky positioning and z-index (clickjacking overlay)", () => {
    expect(cleanStyle("position:fixed;inset:0;z-index:9999;background:#000")).not.toMatch(/fixed|z-index/)
    expect(cleanStyle("position:absolute;z-index:5")).toBe("")
    expect(cleanStyle("position:sticky")).toBe("")
  })

  it("drops url() and expression() values (off-site beacons)", () => {
    expect(cleanStyle("background:url(https://evil/x)")).toBe("")
    expect(cleanStyle("width:1px;background:url(x)")).toBe("width:1px")
  })

  it("keeps KaTeX/highlight layout styles (incl. position:relative)", () => {
    const out = cleanStyle("height:0.8em;vertical-align:-0.19em")
    expect(out).toContain("height:0.8em")
    expect(out).toContain("vertical-align:-0.19em")
    expect(cleanStyle("position:relative;top:2px")).toContain("position:relative")
    expect(cleanStyle("color:#ff0000")).toBe("color:#ff0000")
  })
})


describe("rehypeSafeStyle — plugin scrubs style attributes in the tree", () => {
  const run = (html: string): string => {
    const tree = fromHtml(html, { fragment: true })
    rehypeSafeStyle()(tree)
    return toHtml(tree)
  }

  it("neutralizes a full-viewport overlay span but keeps the element + text", () => {
    const out = run('<span style="position:fixed;inset:0;z-index:9999;background:#000">Sign in</span>')
    expect(out).not.toContain("fixed")
    expect(out).not.toContain("z-index")
    expect(out).toContain("Sign in")
  })

  it("leaves a KaTeX-style span's inline layout intact", () => {
    expect(run('<span style="height:0.8em">x</span>')).toContain("height:0.8em")
  })
})


describe("SANITIZE_SCHEMA — preserves the viewer's intended rich output", () => {
  it("keeps highlight <mark> with its data-color", () => {
    const out = clean('<mark data-color="blue">key</mark>')
    expect(out).toContain("<mark")
    expect(out).toContain("data-color")
    expect(out).toContain("key")
  })

  it("keeps <details>/<summary> toggles", () => {
    const out = clean("<details><summary>more</summary>body</details>")
    expect(out).toContain("<details")
    expect(out).toContain("<summary")
  })

  it("keeps KaTeX MathML output (<math> subtree)", () => {
    const out = clean("<math><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></semantics></math>")
    expect(out).toContain("<math")
    expect(out).toContain("<mi")
  })

  it("keeps KaTeX HTML spans with class + inline layout style", () => {
    const out = clean('<span class="katex" style="height:0.8em" aria-hidden="true">x</span>')
    expect(out).toContain("<span")
    expect(out).toContain('class="katex"')
    expect(out).toContain("height:0.8em")
  })

  it("keeps ordinary links + images on safe schemes", () => {
    expect(clean('<a href="https://example.com/">x</a>')).toContain("https://example.com/")
    expect(clean('<img src="https://example.com/a.png">')).toContain("https://example.com/a.png")
  })
})
