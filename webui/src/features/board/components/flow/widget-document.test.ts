import { describe, expect, it } from "vitest"
import { buildWidgetDocument } from "./widget-document"


// FE-F5: every widget document must ship a CSP, and the CSP <meta> must be the
// parser's FIRST head child so it governs every asset the document then loads
// (connect-src 'none' blocks exfil; script-src denies non-allowlisted origins).

const head = (html: string) => new DOMParser().parseFromString(html, "text/html").head
const isCspMeta = (el: Element | null): boolean =>
  !!el && el.tagName === "META" && (el.getAttribute("http-equiv") ?? "").toLowerCase() === "content-security-policy"


describe("buildWidgetDocument — CSP is present and first-in-head", () => {
  it("injects the CSP as the first head child of a full document", () => {
    const out = buildWidgetDocument("<!doctype html><html><head><title>w</title></head><body>hi</body></html>")
    expect(isCspMeta(head(out).firstElementChild)).toBe(true)
  })

  it("injects the CSP before any resource loader in a body-only widget's document", () => {
    // Constructed head starts with <meta charset> (loads nothing); the CSP must
    // precede any script/link that actually fetches.
    const h = head(buildWidgetDocument('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script><div>hi</div>'))
    const kids = [...h.children]
    const metaIdx = kids.findIndex(isCspMeta)
    expect(metaIdx).toBeGreaterThanOrEqual(0)
    const firstLoader = kids.findIndex((el) => el.tagName === "SCRIPT" || el.tagName === "LINK")
    if (firstLoader !== -1) expect(metaIdx).toBeLessThan(firstLoader)
  })

  // Finding FE-F5-a: a <head> hidden in a comment must not divert the meta.
  it("is not evaded by a comment-hidden <head> (meta stays a real first-in-head element)", () => {
    const evil = '<!doctype html><!-- <head> --><html><head><script>window.x=1</script></head><body>hi</body></html>'
    const h = head(buildWidgetDocument(evil))
    expect(isCspMeta(h.firstElementChild)).toBe(true) // real element, before the script
    // the injected policy is a live meta element, not text buried in a comment
    expect(h.querySelector('meta[http-equiv="Content-Security-Policy" i]')).not.toBeNull()
  })

  // Finding FE-F5-b: a resource before <head> in source is hoisted — the meta
  // must still precede it.
  it("is not evaded by a resource placed before <head> (meta precedes the hoisted node)", () => {
    const evil = '<!doctype html><html><script src="https://evil.example/x.js"></script><head></head><body>hi</body></html>'
    const h = head(buildWidgetDocument(evil))
    expect(isCspMeta(h.firstElementChild)).toBe(true)
    const kids = [...h.children]
    const metaIdx = kids.findIndex(isCspMeta)
    const scriptIdx = kids.findIndex((el) => el.tagName === "SCRIPT")
    if (scriptIdx !== -1) expect(metaIdx).toBeLessThan(scriptIdx) // governed by the CSP
  })
})


describe("buildWidgetDocument — policy blocks the exfil sinks, allows inline + CDN", () => {
  const policy = (): string =>
    head(buildWidgetDocument("<div>hi</div>"))
      .querySelector('meta[http-equiv="Content-Security-Policy" i]')!
      .getAttribute("content") ?? ""

  it("blocks network egress and form/base/frame sinks", () => {
    const p = policy()
    expect(p).toContain("default-src 'none'")
    expect(p).toContain("connect-src 'none'")
    expect(p).toContain("form-action 'none'")
    expect(p).toContain("base-uri 'none'")
  })

  it("keeps images/eval restricted (anti-exfil, per the self-contained contract)", () => {
    const p = policy()
    expect(p).not.toContain("'unsafe-eval'") // mini-apps forbid eval/Function
    // img-src may list the specific CDN https:// origins, but must NOT allow a
    // bare `https:` wildcard (that would reopen image-beacon GET-exfil).
    const imgSrc = p.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src")) ?? ""
    expect(imgSrc.split(/\s+/)).not.toContain("https:")
  })

  it("allows inline scripts/styles, the documented CDNs, and inline media", () => {
    const p = policy()
    expect(p).toMatch(/script-src 'unsafe-inline'[^;]*cdn\.jsdelivr\.net/)
    expect(p).toContain("https://fonts.googleapis.com")
    expect(p).toContain("media-src data: blob:")
  })
})
