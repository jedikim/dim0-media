import { describe, expect, it, vi } from "vitest"

import { GraphLayoutError, layoutGraph } from "./graph-layout"


describe("layoutGraph — node positioning", () => {
  it("passes x/y through unchanged (manual layout)", () => {
    const g = layoutGraph({
      nodes: [{ id: "A", x: 10, y: 20 }],
      edges: [],
    })
    expect(g.nodes[0].x).toBe(10)
    expect(g.nodes[0].y).toBe(20)
  })


  it("uses id as label when label is not provided", () => {
    const g = layoutGraph({
      nodes: [{ id: "node1", x: 0, y: 0 }],
      edges: [],
    })
    expect(g.nodes[0].label).toBe("node1")
  })


  it("uses explicit label when provided", () => {
    const g = layoutGraph({
      nodes: [{ id: "n1", x: 0, y: 0, label: "Start" }],
      edges: [],
    })
    expect(g.nodes[0].label).toBe("Start")
  })


  it("carries sublabel through (null when absent)", () => {
    const g = layoutGraph({
      nodes: [
        { id: "A", x: 0, y: 0, sublabel: "12" },
        { id: "B", x: 0, y: 0 },
      ],
      edges: [],
    })
    expect(g.nodes[0].sublabel).toBe("12")
    expect(g.nodes[1].sublabel).toBeNull()
  })


  it("throws on duplicate node ids", () => {
    expect(() =>
      layoutGraph({
        nodes: [
          { id: "A", x: 0, y: 0 },
          { id: "A", x: 50, y: 50 },
        ],
        edges: [],
      })
    ).toThrow(GraphLayoutError)
  })
})


describe("layoutGraph — color resolution and defaults", () => {
  it("applies default tokens when no colors specified", () => {
    const g = layoutGraph({
      nodes: [{ id: "A", x: 0, y: 0 }],
      edges: [],
    })
    expect(g.nodes[0].color).toBe("var(--card)")
    expect(g.nodes[0].border).toBe("var(--border)")
    expect(g.nodes[0].textColor).toBe("var(--foreground)")
  })


  it("resolves explicit color/border/textColor tokens", () => {
    const g = layoutGraph({
      nodes: [
        {
          id: "A",
          x: 0,
          y: 0,
          color: "chart-1",
          border: "chart-2",
          textColor: "primary-foreground",
        },
      ],
      edges: [],
    })
    expect(g.nodes[0].color).toBe("var(--chart-1)")
    expect(g.nodes[0].border).toBe("var(--chart-2)")
    expect(g.nodes[0].textColor).toBe("var(--primary-foreground)")
  })


  it("passes hex colors through unchanged", () => {
    const g = layoutGraph({
      nodes: [{ id: "A", x: 0, y: 0, color: "#FF4500" }],
      edges: [],
    })
    expect(g.nodes[0].color).toBe("#FF4500")
  })


  it("resolves edge color default and explicit token", () => {
    const g = layoutGraph({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 50, y: 0 },
      ],
      edges: [
        { a: "A", b: "B" },
        { a: "A", b: "B", color: "chart-3" },
      ],
    })
    expect(g.edges[0].color).toBe("var(--border)")
    expect(g.edges[1].color).toBe("var(--chart-3)")
  })
})


describe("layoutGraph — edge endpoints", () => {
  it("looks up edge endpoints by node id", () => {
    const g = layoutGraph({
      nodes: [
        { id: "A", x: 10, y: 20 },
        { id: "B", x: 100, y: 200 },
      ],
      edges: [{ a: "A", b: "B", label: "5" }],
    })
    expect(g.edges[0]).toMatchObject({
      a: "A",
      b: "B",
      x1: 10,
      y1: 20,
      x2: 100,
      y2: 200,
      label: "5",
    })
  })


  it("drops edges referencing unknown nodes and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const g = layoutGraph({
      nodes: [{ id: "A", x: 0, y: 0 }],
      edges: [
        { a: "A", b: "ghost" },
        { a: "missing", b: "A" },
      ],
    })
    expect(g.edges.length).toBe(0)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })


  it("edge label defaults to null when not provided", () => {
    const g = layoutGraph({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 50, y: 0 },
      ],
      edges: [{ a: "A", b: "B" }],
    })
    expect(g.edges[0].label).toBeNull()
  })
})


describe("layoutGraph — viewBox", () => {
  it("auto-computes viewBox from node extent with 30px padding", () => {
    const g = layoutGraph({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 100, y: 60 },
      ],
      edges: [],
    })
    // extent: x ∈ [0, 100], y ∈ [0, 60]; padding=30
    // → "(-30) (-30) (100 + 60) (60 + 60)" = "-30 -30 160 120"
    expect(g.viewBox).toBe("-30 -30 160 120")
  })


  it("explicit viewBox overrides auto-computed", () => {
    const g = layoutGraph({
      nodes: [{ id: "A", x: 0, y: 0 }],
      edges: [],
      viewBox: "0 0 500 400",
    })
    expect(g.viewBox).toBe("0 0 500 400")
  })


  it("empty nodes list falls back to a default viewBox", () => {
    const g = layoutGraph({ nodes: [], edges: [] })
    expect(g.viewBox).toBe("0 0 100 100")
  })


  it("single-node viewBox still applies padding", () => {
    const g = layoutGraph({
      nodes: [{ id: "A", x: 50, y: 50 }],
      edges: [],
    })
    // extent: x=50, y=50; padding=30 → "20 20 60 60"
    expect(g.viewBox).toBe("20 20 60 60")
  })
})
