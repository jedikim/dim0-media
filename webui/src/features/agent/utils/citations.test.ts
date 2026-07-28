import { describe, expect, it } from "vitest"
import { postProcessUrlCitations } from "./citations"


const URL = "https://example.com/research/quantum-computing-2026"
const OTHER = "https://arxiv.org/abs/2601.01234"


describe("postProcessUrlCitations", () => {
  it("leaves an exact source URL untouched", () => {
    expect(postProcessUrlCitations(`See ${URL} for details.`, [URL])).toBe(`See ${URL} for details.`)
  })

  it("completes a truncated URL back to the real source (trie tail)", () => {
    const truncated = URL.slice(0, -6) // model dropped the last 6 chars
    expect(postProcessUrlCitations(`Source: ${truncated}`, [URL])).toBe(`Source: ${URL}`)
  })

  it("trims trailing garbage past a complete source URL", () => {
    expect(postProcessUrlCitations(`${URL}abcXYZ done`, [URL])).toBe(`${URL} done`)
  })

  it("leaves an unrelated URL alone (diverges before MIN_MATCHES)", () => {
    // only "https://" matches the trie, then it diverges → < 10 matched chars.
    expect(postProcessUrlCitations(`ref ${OTHER}`, [URL])).toBe(`ref ${OTHER}`)
  })

  it("does not touch a too-short prefix (< MIN_MATCHES)", () => {
    expect(postProcessUrlCitations("go to https:// now", [URL])).toBe("go to https:// now")
  })

  it("no sources → answer unchanged", () => {
    expect(postProcessUrlCitations(`text ${URL} more`, [])).toBe(`text ${URL} more`)
  })

  it("corrects each URL in a multi-source answer independently", () => {
    const t1 = URL.slice(0, -3)
    const t2 = OTHER.slice(0, -2)
    // Separate with spaces: like the backend, the URL regex includes '.', so a
    // period butted against a URL is consumed into the match (a known quirk).
    const answer = `First ${t1} then ${t2} end`
    expect(postProcessUrlCitations(answer, [URL, OTHER])).toBe(`First ${URL} then ${OTHER} end`)
  })

  it("leaves non-URL prose alone", () => {
    expect(postProcessUrlCitations("no links here at all", [URL])).toBe("no links here at all")
  })
})
