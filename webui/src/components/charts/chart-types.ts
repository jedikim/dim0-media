// Type contract for the <chart> custom element.
//
// `ChartProps` mirrors the YAML the agent writes (Chart.js-flavored:
// labels + parallel data arrays per dataset). `RechartsConfig` is the
// recharts-ready shape (row-of-objects data, series specs). The pure
// translator in chart-translate.ts maps the former to the latter.


// === INPUT — what the agent writes in YAML ===


export type ChartKind = "bar" | "line" | "area" | "scatter" | "pie" | "composed"


export type SeriesType = "bar" | "line" | "area" | "scatter"


export interface ChartProps {
  kind: ChartKind
  labels?: (string | number)[]
  // Shorthand for a single series, or pie slices when `kind === "pie"`.
  // Mutually exclusive with `datasets`.
  data?: (number | null)[] | PieDatum[]
  datasets?: ChartDataset[]
  // Fallback color when datasets[].color is absent (or when using shorthand).
  color?: string
  height?: number
  yAxis?: ChartYAxis[]
  xAxis?: { label?: string; hide?: boolean }
  legend?: boolean | "top" | "bottom" | "left" | "right"
  tooltip?: boolean
}


export interface ChartDataset {
  // Only meaningful when chart kind is "composed"; otherwise the chart-level
  // kind wins.
  type?: SeriesType
  label: string
  data: (number | null)[]
  color?: string
  // References a ChartYAxis.id when the chart has multiple y-axes.
  yAxis?: string
}


export interface PieDatum {
  name: string
  value: number
  color?: string
}


export interface ChartYAxis {
  id: string
  label?: string
  side?: "left" | "right"
}


// === OUTPUT — what recharts consumes (after translation) ===


export type RechartsConfig = CartesianConfig | PieConfig


export interface CartesianConfig {
  kind: "bar" | "line" | "area" | "scatter" | "composed"
  // Row-of-objects: each row has `xKey` plus one numeric column per series.
  data: Row[]
  xKey: string
  series: SeriesSpec[]
  yAxes: YAxisSpec[]
  xAxis: { label?: string; hide?: boolean }
  legend: boolean | "top" | "bottom" | "left" | "right"
  tooltip: boolean
  height: number
}


export interface PieConfig {
  kind: "pie"
  data: ResolvedPieDatum[]
  legend: boolean | "top" | "bottom" | "left" | "right"
  tooltip: boolean
  height: number
}


export interface SeriesSpec {
  type: SeriesType
  // The key under which this series' values live in each Row.
  dataKey: string
  // Already resolved by color-token.ts — either `var(--X)` or a
  // pass-through literal.
  color: string
  yAxisId?: string
  label: string
}


export interface YAxisSpec {
  id: string
  label?: string
  orientation: "left" | "right"
}


export interface ResolvedPieDatum {
  name: string
  value: number
  color: string
}


export type Row = Record<string, string | number | null>
