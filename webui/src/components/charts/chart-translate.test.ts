import { describe, expect, it } from "vitest"

import { ChartTranslateError, translateChart } from "./chart-translate"
import type { CartesianConfig, ChartProps, PieConfig } from "./chart-types"


function asCartesian(props: ChartProps): CartesianConfig {
  const out = translateChart(props)
  if (out.kind === "pie") throw new Error("expected cartesian output")
  return out
}


function asPie(props: ChartProps): PieConfig {
  const out = translateChart(props)
  if (out.kind !== "pie") throw new Error("expected pie output")
  return out
}


describe("translateChart — bar shorthand", () => {
  it("expands `data` into a single dataset and zips with labels", () => {
    const config = asCartesian({
      kind: "bar",
      labels: ["Jan", "Feb", "Mar"],
      data: [12, 19, 8],
      color: "chart-1",
    })
    expect(config.kind).toBe("bar")
    expect(config.xKey).toBe("x")
    expect(config.data).toEqual([
      { x: "Jan", value: 12 },
      { x: "Feb", value: 19 },
      { x: "Mar", value: 8 },
    ])
    expect(config.series).toEqual([
      {
        type: "bar",
        dataKey: "value",
        color: "var(--chart-1)",
        yAxisId: undefined,
        label: "value",
      },
    ])
  })


  it("defaults color to first palette color when none specified", () => {
    const config = asCartesian({
      kind: "bar",
      labels: ["a"],
      data: [1],
    })
    expect(config.series[0].color).toBe("var(--chart-1)")
  })
})


describe("translateChart — bar multi-series", () => {
  it("emits one series per dataset, all typed as bar", () => {
    const config = asCartesian({
      kind: "bar",
      labels: ["Jan", "Feb"],
      datasets: [
        { label: "Sales", data: [12, 19], color: "chart-1" },
        { label: "Returns", data: [2, 3], color: "chart-2" },
      ],
    })
    expect(config.series.length).toBe(2)
    expect(config.series.map((s) => s.type)).toEqual(["bar", "bar"])
    expect(config.series.map((s) => s.dataKey)).toEqual(["Sales", "Returns"])
    expect(config.data).toEqual([
      { x: "Jan", Sales: 12, Returns: 2 },
      { x: "Feb", Sales: 19, Returns: 3 },
    ])
  })


  it("rotates default palette across datasets without explicit color", () => {
    const config = asCartesian({
      kind: "bar",
      labels: ["a"],
      datasets: [
        { label: "A", data: [1] },
        { label: "B", data: [2] },
        { label: "C", data: [3] },
      ],
    })
    expect(config.series.map((s) => s.color)).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
    ])
  })
})


describe("translateChart — line", () => {
  it("emits line-typed series for kind=line", () => {
    const config = asCartesian({
      kind: "line",
      labels: ["a", "b", "c"],
      datasets: [{ label: "x", data: [1, 2, 3] }],
    })
    expect(config.series[0].type).toBe("line")
  })
})


describe("translateChart — composed", () => {
  it("respects per-dataset type in composed kind", () => {
    const config = asCartesian({
      kind: "composed",
      labels: ["a"],
      datasets: [
        { type: "bar", label: "B", data: [1] },
        { type: "line", label: "L", data: [2] },
      ],
    })
    expect(config.series.map((s) => s.type)).toEqual(["bar", "line"])
  })


  it("defaults dataset type to bar when omitted in composed", () => {
    const config = asCartesian({
      kind: "composed",
      labels: ["a"],
      datasets: [{ label: "X", data: [1] }],
    })
    expect(config.series[0].type).toBe("bar")
  })


  it("dataset.type is IGNORED when chart kind is not composed", () => {
    const config = asCartesian({
      kind: "line",
      labels: ["a"],
      // Dataset says bar, but chart-level kind=line wins.
      datasets: [{ type: "bar", label: "X", data: [1] }],
    })
    expect(config.series[0].type).toBe("line")
  })
})


describe("translateChart — two y-axes", () => {
  it("emits two yAxes and carries dataset.yAxis as yAxisId on each series", () => {
    const config = asCartesian({
      kind: "composed",
      labels: ["Q1", "Q2"],
      yAxis: [
        { id: "revenue", label: "Revenue", side: "left" },
        { id: "orders", label: "Orders", side: "right" },
      ],
      datasets: [
        { type: "bar", label: "Revenue", data: [240, 310], yAxis: "revenue" },
        { type: "line", label: "Orders", data: [1200, 1450], yAxis: "orders" },
      ],
    })
    expect(config.yAxes.length).toBe(2)
    expect(config.yAxes.map((a) => a.orientation)).toEqual(["left", "right"])
    expect(config.series.map((s) => s.yAxisId)).toEqual(["revenue", "orders"])
  })


  it("synthesizes a default left-side axis when yAxis is omitted", () => {
    const config = asCartesian({
      kind: "bar",
      labels: ["a"],
      data: [1],
    })
    expect(config.yAxes).toEqual([
      { id: "_default", label: undefined, orientation: "left" },
    ])
  })
})


describe("translateChart — pie", () => {
  it("passes through name/value pairs with resolved colors", () => {
    const config = asPie({
      kind: "pie",
      data: [
        { name: "Direct", value: 42, color: "chart-1" },
        { name: "Search", value: 28, color: "chart-2" },
      ],
    })
    expect(config.data).toEqual([
      { name: "Direct", value: 42, color: "var(--chart-1)" },
      { name: "Search", value: 28, color: "var(--chart-2)" },
    ])
  })


  it("assigns default palette colors to slices without a color", () => {
    const config = asPie({
      kind: "pie",
      data: [
        { name: "A", value: 1 },
        { name: "B", value: 2 },
      ],
    })
    expect(config.data.map((d) => d.color)).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
    ])
  })
})


describe("translateChart — color handling", () => {
  it("hex colors pass through untouched", () => {
    const config = asCartesian({
      kind: "bar",
      labels: ["a"],
      datasets: [{ label: "X", data: [1], color: "#FF4500" }],
    })
    expect(config.series[0].color).toBe("#FF4500")
  })
})


describe("translateChart — data shape edge cases", () => {
  it("null values in a dataset survive into the row data", () => {
    const config = asCartesian({
      kind: "line",
      labels: ["a", "b", "c"],
      datasets: [{ label: "X", data: [1, null, 3] }],
    })
    expect(config.data).toEqual([
      { x: "a", X: 1 },
      { x: "b", X: null },
      { x: "c", X: 3 },
    ])
  })


  it("auto-generates string labels when only datasets are provided", () => {
    const config = asCartesian({
      kind: "line",
      datasets: [{ label: "X", data: [10, 20, 30] }],
    })
    expect(config.data.map((row) => row.x)).toEqual(["0", "1", "2"])
  })


  it("empty datasets array produces empty data + empty series", () => {
    const config = asCartesian({
      kind: "bar",
      labels: ["a"],
      datasets: [],
    })
    expect(config.data).toEqual([{ x: "a" }])
    expect(config.series).toEqual([])
  })
})


describe("translateChart — defaults & options", () => {
  it("legend defaults to true", () => {
    const config = asCartesian({ kind: "bar", labels: ["a"], data: [1] })
    expect(config.legend).toBe(true)
  })


  it("tooltip defaults to true", () => {
    const config = asCartesian({ kind: "bar", labels: ["a"], data: [1] })
    expect(config.tooltip).toBe(true)
  })


  it("height defaults to 200", () => {
    const config = asCartesian({ kind: "bar", labels: ["a"], data: [1] })
    expect(config.height).toBe(200)
  })


  it("explicit legend=false is preserved", () => {
    const config = asCartesian({
      kind: "bar",
      labels: ["a"],
      data: [1],
      legend: false,
    })
    expect(config.legend).toBe(false)
  })
})


describe("translateChart — validation", () => {
  it("rejects when both data and datasets are provided", () => {
    expect(() =>
      translateChart({
        kind: "bar",
        labels: ["a"],
        data: [1],
        datasets: [{ label: "X", data: [1] }],
      })
    ).toThrow(ChartTranslateError)
  })
})
