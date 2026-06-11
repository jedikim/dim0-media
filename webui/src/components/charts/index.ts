// Shared chart + graph primitives used by:
//   - the host bundle (e.g. preview surfaces, future inline embeds)
//   - the mini-app iframe runtime (exposed in MINI_APP_SCOPE as
//     `Chart` and `Graph` for agent-authored widgets)
//
// Keeping them under src/components/ (not under a feature dir) makes
// it explicit they're general primitives, not tied to any feature's
// lifecycle. The tests live alongside the source.

export { ChartElement } from "./chart"
export type {
  ChartDataset,
  ChartKind,
  ChartProps,
  ChartYAxis,
  PieDatum,
  SeriesType,
} from "./chart-types"
export { ChartTranslateError, translateChart } from "./chart-translate"

export { GraphElement } from "./graph"
export type { GraphEdge, GraphNode, GraphProps } from "./graph-types"
export { GraphLayoutError, layoutGraph } from "./graph-layout"

export { defaultPaletteColor, resolveColor } from "./color-token"
