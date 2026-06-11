// React component for the <chart> custom element.
//
// Thin layer: runs the pure translator (chart-translate.ts), then maps the
// resulting RechartsConfig onto recharts components. All shape decisions
// live in the translator; this file is just rendering.

import { useMemo } from "react"
import type { ComponentType, ReactNode } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { translateChart } from "./chart-translate"
import type {
  CartesianConfig,
  ChartProps,
  PieConfig,
  SeriesSpec,
  YAxisSpec,
} from "./chart-types"


export function ChartElement(props: ChartProps) {
  const config = useMemo(() => translateChart(props), [props])
  if (config.kind === "pie") return <PieRenderer config={config} />
  return <CartesianRenderer config={config} />
}


function CartesianRenderer({ config }: { config: CartesianConfig }) {
  const Root = pickCartesianRoot(config.kind)
  return (
    <ResponsiveContainer width="100%" height={config.height}>
      <Root data={config.data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={config.xKey} {...config.xAxis} />
        {config.yAxes.map((ax) => (
          <YAxis
            key={ax.id}
            yAxisId={ax.id}
            orientation={ax.orientation}
            label={ax.label}
          />
        ))}
        {config.tooltip ? <Tooltip /> : null}
        {config.legend ? <Legend /> : null}
        {config.series.map((s) => renderSeries(s, config.yAxes))}
      </Root>
    </ResponsiveContainer>
  )
}


function PieRenderer({ config }: { config: PieConfig }) {
  // Cast at the boundary: ResolvedPieDatum is structurally compatible with
  // recharts' ChartDataInput[], but the latter declares an index signature
  // that our strict interface omits.
  const pieData = config.data as unknown as Record<string, unknown>[]
  return (
    <ResponsiveContainer width="100%" height={config.height}>
      <PieChart>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          outerRadius="70%"
          label
          isAnimationActive={false}
        >
          {config.data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Pie>
        {config.tooltip ? <Tooltip /> : null}
        {config.legend ? <Legend /> : null}
      </PieChart>
    </ResponsiveContainer>
  )
}


type CartesianRoot =
  | typeof BarChart
  | typeof LineChart
  | typeof AreaChart
  | typeof ScatterChart
  | typeof ComposedChart


function pickCartesianRoot(kind: CartesianConfig["kind"]): CartesianRoot {
  switch (kind) {
    case "bar":
      return BarChart
    case "line":
      return LineChart
    case "area":
      return AreaChart
    case "scatter":
      return ScatterChart
    case "composed":
      return ComposedChart
  }
}


function renderSeries(s: SeriesSpec, axes: YAxisSpec[]): ReactNode {
  // recharts requires every series to declare a yAxisId matching one of the
  // mounted <YAxis> components. Series without an explicit yAxis fall back
  // to the first declared axis (which is the synthetic "_default" in the
  // single-axis case).
  const yAxisId = s.yAxisId ?? axes[0]?.id
  const Comp = pickSeriesComponent(s.type)
  // Disable recharts' built-in mount/transition animations. The runtime
  // drives chart animation via `state.tween` writes (which then re-render
  // recharts with the new snapshot); letting recharts animate too would
  // compound and visibly stutter.
  const common = {
    dataKey: s.dataKey,
    name: s.label,
    yAxisId,
    isAnimationActive: false,
  }
  if (s.type === "line") {
    return <Comp key={s.dataKey} {...common} stroke={s.color} dot={false} />
  }
  if (s.type === "area") {
    return <Comp key={s.dataKey} {...common} stroke={s.color} fill={s.color} />
  }
  return <Comp key={s.dataKey} {...common} fill={s.color} />
}


function pickSeriesComponent(
  type: SeriesSpec["type"]
): ComponentType<Record<string, unknown>> {
  switch (type) {
    case "bar":
      return Bar as unknown as ComponentType<Record<string, unknown>>
    case "line":
      return Line as unknown as ComponentType<Record<string, unknown>>
    case "area":
      return Area as unknown as ComponentType<Record<string, unknown>>
    case "scatter":
      return Scatter as unknown as ComponentType<Record<string, unknown>>
  }
}
