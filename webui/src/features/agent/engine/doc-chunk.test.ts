import { describe, expect, it } from "vitest"
import { chunkMarkdown, type Chunk } from "./doc-chunk"


const strip = (s: string): string => s.replace(/\s/g, "")
const joined = (chunks: Chunk[]): string => chunks.map((c) => c.text).join("\n\n")


describe("chunkMarkdown — basics", () => {
  it("returns [] for empty or whitespace-only input", () => {
    expect(chunkMarkdown("")).toEqual([])
    expect(chunkMarkdown("   \n\n  ")).toEqual([])
    expect(chunkMarkdown("\r\n\r\n \t ")).toEqual([])
  })

  it("keeps a short document as a single chunk with index 0", () => {
    const out = chunkMarkdown("# Title\n\nA short paragraph.")
    expect(out).toEqual([{ index: 0, text: "# Title\n\nA short paragraph." }])
  })
})


describe("chunkMarkdown — invariants (hold for any input/options)", () => {
  const cases: { name: string; md: string; maxChars: number; overlap: number }[] = [
    { name: "many small paras", md: Array.from({ length: 30 }, (_, i) => `para ${i} ${"x".repeat(30)}`).join("\n\n"), maxChars: 100, overlap: 0 },
    { name: "with overlap", md: Array.from({ length: 12 }, (_, i) => `para ${i} ${"y".repeat(50)}`).join("\n\n"), maxChars: 120, overlap: 20 },
    { name: "one giant block", md: "z".repeat(1000), maxChars: 100, overlap: 0 },
    { name: "giant then small", md: "z".repeat(250) + "\n\ntail", maxChars: 100, overlap: 0 },
    { name: "small then giant", md: "head\n\n" + "z".repeat(250), maxChars: 100, overlap: 0 },
    { name: "headings only", md: "# A\n\n## B\n\n### C", maxChars: 100, overlap: 0 },
    { name: "ragged blank lines", md: "a\n\n\n\n\nb\n\n\n c ", maxChars: 100, overlap: 0 },
    { name: "block exactly maxChars", md: "q".repeat(100), maxChars: 100, overlap: 0 },
    { name: "block maxChars+1", md: "q".repeat(101), maxChars: 100, overlap: 0 },
    { name: "spaced prose oversized", md: "one two three four five six seven eight nine ten", maxChars: 12, overlap: 0 },
    { name: "multi-line block oversized", md: "aaaa\nbbbb\ncccc\ndddd", maxChars: 6, overlap: 0 },
    { name: "sections with headings", md: `# A\n\n${"x".repeat(40)}\n\n# B\n\n${"y".repeat(40)}`, maxChars: 50, overlap: 0 },
    { name: "heading glued to body", md: "# H\nbody\n## Sub\nmore\n\npara", maxChars: 40, overlap: 5 },
    { name: "one long word", md: "x".repeat(37), maxChars: 10, overlap: 0 },
    { name: "line longer than a word run", md: `short\n${"one two three four five"}`, maxChars: 10, overlap: 0 },
  ]

  for (const { name, md, maxChars, overlap } of cases) {
    it(`[${name}] indices are sequential and chunks are non-empty`, () => {
      const out = chunkMarkdown(md, { maxChars, overlap })
      out.forEach((c, i) => expect(c.index).toBe(i))
      out.forEach((c) => expect(c.text.trim().length).toBeGreaterThan(0))
    })

    it(`[${name}] is deterministic`, () => {
      expect(chunkMarkdown(md, { maxChars, overlap })).toEqual(chunkMarkdown(md, { maxChars, overlap }))
    })
  }

  it("overlap=0 loses no content (stripped concat === stripped source)", () => {
    for (const { md, maxChars } of cases) {
      const out = chunkMarkdown(md, { maxChars, overlap: 0 })
      // Packing only inserts whitespace and hard-split only slices → no chars lost.
      expect(strip(joined(out))).toBe(strip(md))
    }
  })

  it("overlap=0 → no chunk exceeds maxChars", () => {
    for (const { md, maxChars } of cases) {
      for (const c of chunkMarkdown(md, { maxChars, overlap: 0 })) {
        expect(c.text.length).toBeLessThanOrEqual(maxChars)
      }
    }
  })
})


describe("chunkMarkdown — packing + hard-split boundaries", () => {
  it("does not split a block that is exactly maxChars", () => {
    expect(chunkMarkdown("q".repeat(100), { maxChars: 100, overlap: 0 })).toEqual([
      { index: 0, text: "q".repeat(100) },
    ])
  })

  it("hard-splits a single block larger than maxChars into ceil(len/maxChars) pieces", () => {
    const out = chunkMarkdown("y".repeat(250), { maxChars: 100, overlap: 0 })
    expect(out.map((c) => c.text.length)).toEqual([100, 100, 50])
  })

  it("flushes a pending small block before hard-splitting a following giant block", () => {
    const out = chunkMarkdown("head\n\n" + "z".repeat(250), { maxChars: 100, overlap: 0 })
    expect(out[0].text).toBe("head") // not merged into the giant fragments
    expect(out.slice(1).map((c) => c.text.length)).toEqual([100, 100, 50])
  })

  it("starts a fresh chunk for a small block after a hard-split giant block", () => {
    const out = chunkMarkdown("z".repeat(250) + "\n\ntail", { maxChars: 100, overlap: 0 })
    expect(out.map((c) => c.text)).toEqual(["z".repeat(100), "z".repeat(100), "z".repeat(50), "tail"])
  })

  it("packs multiple blocks into one chunk when they fit", () => {
    const out = chunkMarkdown("aaa\n\nbbb\n\nccc", { maxChars: 100, overlap: 0 })
    expect(out).toEqual([{ index: 0, text: "aaa\n\nbbb\n\nccc" }])
  })
})


describe("chunkMarkdown — overlap", () => {
  it("prepends the previous chunk's tail to each subsequent chunk (not the first)", () => {
    const md = ["A".repeat(60), "B".repeat(60)].join("\n\n")
    const out = chunkMarkdown(md, { maxChars: 70, overlap: 10 })
    expect(out).toHaveLength(2)
    expect(out[0].text).toBe("A".repeat(60)) // first chunk: no prefix
    expect(out[1].text).toBe("A".repeat(10) + "\n\n" + "B".repeat(60))
  })

  it("clamps an overlap >= maxChars to maxChars-1 without throwing", () => {
    const md = ["A".repeat(40), "B".repeat(40)].join("\n\n")
    const out = chunkMarkdown(md, { maxChars: 50, overlap: 999 })
    expect(out).toHaveLength(2)
    // bounded by the previous chunk length (40) and the clamp (49) → 40.
    expect(out[1].text.startsWith("A".repeat(40) + "\n\n")).toBe(true)
  })
})


describe("chunkMarkdown — line endings", () => {
  it("splits CRLF-delimited paragraphs (PDF exports) the same as LF", () => {
    const crlf = "para one\r\n\r\npara two\r\n\r\npara three"
    const lf = "para one\n\npara two\n\npara three"
    expect(chunkMarkdown(crlf, { maxChars: 20, overlap: 0 })).toEqual(
      chunkMarkdown(lf, { maxChars: 20, overlap: 0 }),
    )
    // and it actually produced >1 chunk (i.e. the blank lines were recognized)
    expect(chunkMarkdown(crlf, { maxChars: 20, overlap: 0 }).length).toBeGreaterThan(1)
  })
})


describe("chunkMarkdown — heading-aware section breaks", () => {
  it("ends a substantial chunk at the next heading so a section stays intact", () => {
    const md = `## Alpha\n\n${"a".repeat(60)}\n\n## Beta\n\n${"b".repeat(60)}`
    const out = chunkMarkdown(md, { maxChars: 200, overlap: 0 }) // minChars = 66
    expect(out.map((c) => c.text)).toEqual([
      `## Alpha\n\n${"a".repeat(60)}`,
      `## Beta\n\n${"b".repeat(60)}`,
    ])
  })

  it("does NOT break at a heading while the current chunk is still small (packs tiny sections)", () => {
    // Six tiny sections, each well under minChars → all packed into one chunk
    // instead of shattering into one-liners (mirrors legacy min_chunk_size).
    const md = "# A\n\nx\n\n# B\n\ny\n\n# C\n\nz"
    const out = chunkMarkdown(md, { maxChars: 200, overlap: 0 }) // minChars = 66
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(md)
  })

  it("minChars=1 forces a fresh chunk at every heading", () => {
    const md = "# A\n\nx\n\n# B\n\ny\n\n# C\n\nz"
    const out = chunkMarkdown(md, { maxChars: 200, overlap: 0, minChars: 1 })
    expect(out.map((c) => c.text)).toEqual(["# A\n\nx", "# B\n\ny", "# C\n\nz"])
  })

  it("starts a block at a heading even with no blank line before it", () => {
    const md = "# Title\nbody line one\n## Sub\nbody two"
    const out = chunkMarkdown(md, { maxChars: 1000, overlap: 0, minChars: 1 })
    expect(out.map((c) => c.text)).toEqual(["# Title\nbody line one", "## Sub\nbody two"])
  })

  it("does NOT prepend the previous section's overlap tail to a section-start chunk", () => {
    // Two full sections; overlap is on. The second chunk opens a new section, so
    // it must start with its heading — not the tail of the first section.
    const md = `## Alpha\n\n${"a".repeat(60)}\n\n## Beta\n\n${"b".repeat(60)}`
    const out = chunkMarkdown(md, { maxChars: 200, overlap: 10, minChars: 20 })
    expect(out).toHaveLength(2)
    expect(out[1].text).toBe(`## Beta\n\n${"b".repeat(60)}`) // clean section start, no "a…" prefix
  })

  it("still applies overlap to a continuation chunk that is NOT a section start", () => {
    // No headings → the second chunk is a plain continuation and keeps its tail.
    const md = `${"A".repeat(60)}\n\n${"B".repeat(60)}`
    const out = chunkMarkdown(md, { maxChars: 70, overlap: 10 })
    expect(out[1].text).toBe(`${"A".repeat(10)}\n\n${"B".repeat(60)}`)
  })

  it("treats an empty-title heading line ('## ') as a heading consistently", () => {
    // Regression: the block trims to '##', but its heading-ness is decided on the
    // raw line, so it still forces a section break (single source of truth).
    const md = "para one\n\n## \n\npara two"
    const out = chunkMarkdown(md, { maxChars: 1000, overlap: 0, minChars: 1 })
    expect(out).toHaveLength(2)
    expect(out[1].text).toBe("##\n\npara two")
  })
})


describe("chunkMarkdown — heading detection (matches the legacy `^#{1,6}\\s` rule)", () => {
  // With minChars=1 a real heading forces a break; a non-heading does not — so
  // chunk count distinguishes what counts as a heading.
  const chunks = (md: string) => chunkMarkdown(md, { maxChars: 1000, overlap: 0, minChars: 1 })

  it("treats 1–6 leading # + space as a heading (breaks)", () => {
    expect(chunks("para one\n\n###### six\n\npara two")).toHaveLength(2)
  })

  it("does not treat 7+ # as a heading (no break)", () => {
    expect(chunks("para one\n\n####### seven\n\npara two")).toHaveLength(1)
  })

  it("does not treat a # without a following space as a heading (no break)", () => {
    expect(chunks("para one\n\n#nospace\n\npara two")).toHaveLength(1)
  })
})


describe("chunkMarkdown — separator cascade for oversized blocks", () => {
  it("splits a multi-line block at line boundaries (no line cut mid-way)", () => {
    const md = `${"a".repeat(60)}\n${"b".repeat(60)}\n${"c".repeat(60)}` // one block, 3 lines
    const out = chunkMarkdown(md, { maxChars: 100, overlap: 0 })
    expect(out.map((c) => c.text)).toEqual(["a".repeat(60), "b".repeat(60), "c".repeat(60)])
  })

  it("splits at word boundaries when there is no newline (no mid-word cut)", () => {
    const out = chunkMarkdown("alpha beta gamma delta", { maxChars: 10, overlap: 0 })
    expect(out.map((c) => c.text)).toEqual(["alpha beta", "gamma", "delta"])
  })

  it("falls back to characters only when a single word exceeds maxChars", () => {
    const out = chunkMarkdown("supercalifragilistic", { maxChars: 5, overlap: 0 }) // 20 chars, no seams
    expect(out.map((c) => c.text.length)).toEqual([5, 5, 5, 5])
    expect(out.map((c) => c.text).join("")).toBe("supercalifragilistic")
  })

  it("recurses line → word when a single line still exceeds maxChars", () => {
    const md = "short\none two three four five" // one block: a short line + a long line
    const out = chunkMarkdown(md, { maxChars: 10, overlap: 0 })
    expect(out.map((c) => c.text)).toEqual(["short", "one two", "three four", "five"])
  })

  it("never emits a chunk over maxChars from an oversized block", () => {
    const md = `${"w".repeat(30)} ${"z".repeat(30)}\n${"q".repeat(45)}`
    for (const c of chunkMarkdown(md, { maxChars: 20, overlap: 0 })) {
      expect(c.text.length).toBeLessThanOrEqual(20)
    }
  })
})
