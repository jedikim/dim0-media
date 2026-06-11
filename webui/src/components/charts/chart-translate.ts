// Pure function: translate the agent-written `ChartProps` (Chart.js-flavored)
// into the recharts-ready `RechartsConfig` shape.
//
// Locked-down contract — the test suite for this file is the source of truth
// for what the YAML→config mapping does. Recharts can change its own API
// internally and only chart.tsx needs to follow; this file stays stable.

import { defaultPaletteColor, resolveColor } from "./color-token"
import type {
  ChartDataset,
  ChartProps,
  PieConfig,
  PieDatum,
  RechartsConfig,
  Row,
  SeriesSpec,
  SeriesType,
  YAxisSpec,
} from "./chart-types"


export class ChartTranslateError extends Error {}


export function translateChart(props: ChartProps): RechartsConfig {
  if (props.data != null && props.datasets != null) {
    throw new ChartTranslateError(
      "chart accepts either `data` (shorthand) or `datasets` (full form), not both"
    )
  }

  if (props.kind === "pie") return translatePie(props)
  return translateCartesian(props)
}


// --- pie ---------------------------------------------------------------


function translatePie(props: ChartProps): PieConfig {
  const slices: PieDatum[] = Array.isArray(props.data)
    ? (props.data as PieDatum[])
    : []
  return {
    kind: "pie",
    data: slices.map((s, i) => ({
      name: s.name,
      value: s.value,
      color: s.color ? resolveColor(s.color) : defaultPaletteColor(i),
    })),
    legend: props.legend ?? true,
    tooltip: props.tooltip ?? true,
    height: props.height ?? 200,
  }
}


// --- cartesian (bar / line / area / scatter / composed) -----------------


function translateCartesian(props: ChartProps) {
  const datasets = normalizeDatasets(props)

  // Labels are required to align series; auto-generate "0", "1", "2", ...
  // when omitted (matches the "I just want to chart this array" mental model).
  const labels =
    props.labels ?? datasets[0]?.data.map((_, i) => String(i)) ?? []

  const data: Row[] = labels.map((label, i) => {
    const row: Row = { x: String(label) }
    for (const ds of datasets) {
      row[ds.label] = ds.data[i] ?? null
    }
    return row
  })

  const series: SeriesSpec[] = datasets.map((ds, i) => ({
    type: resolveSeriesType(ds, props.kind),
    dataKey: ds.label,
    color: ds.color ? resolveColor(ds.color) : defaultPaletteColor(i),
    yAxisId: ds.yAxis,
    label: ds.label,
  }))

  const yAxes: YAxisSpec[] = (
    props.yAxis ?? [{ id: "_default", side: "left" as const }]
  ).map((a) => ({
    id: a.id,
    label: a.label,
    orientation: a.side ?? "left",
  }))

  return {
    kind: props.kind as
      | "bar"
      | "line"
      | "area"
      | "scatter"
      | "composed",
    data,
    xKey: "x",
    series,
    yAxes,
    xAxis: props.xAxis ?? {},
    legend: props.legend ?? true,
    tooltip: props.tooltip ?? true,
    height: props.height ?? 200,
  }
}


// Collapse the shorthand `data` form into the full `datasets` form. The rest
// of the translator can then treat every input identically.
function normalizeDatasets(props: ChartProps): ChartDataset[] {
  if (props.datasets) return props.datasets
  if (props.data) {
    return [
      {
        label: "value",
        data: props.data as (number | null)[],
        color: props.color,
      },
    ]
  }
  return []
}


// Series type follows the dataset's explicit `type` only when the chart is
// "composed". Otherwise the chart-level kind wins so a single `kind: line`
// chart doesn't accidentally render bars because a dataset said `type: bar`.
function resolveSeriesType(ds: ChartDataset, chartKind: string): SeriesType {
  if (chartKind === "composed") return ds.type ?? "bar"
  return chartKind as SeriesType
}
