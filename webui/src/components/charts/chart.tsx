// Thin lazy wrapper around the recharts-heavy ChartElement.
//
// recharts ships at ~190KB gz once tree-shaken — too heavy to eagerly
// bundle into the mini-app iframe runtime, where a board may have no
// chart-using widgets at all. By lazy-importing the implementation,
// the recharts chunk is fetched only the first time a Chart renders.
//
// What this means in practice:
//   * Iframe runtime initial bundle: ~120KB gz (no recharts) instead
//     of ~310KB gz.
//   * First mount of a Chart: brief Suspense fallback while the chunk
//     loads (~50-200ms typical, then cached for the rest of the
//     session).
//   * Subsequent Chart mounts: instant — chunk is already in the
//     module graph.
//
// The chart-impl.tsx file holds all the actual recharts code; this
// file just defers to it.

import { Suspense, lazy } from "react"

import type { ChartProps } from "./chart-types"


// React.lazy wants a `default` export; chart-impl exports a named
// ChartElement, so we adapt at the boundary.
const ChartImpl = lazy(() =>
  import("./chart-impl").then((m) => ({ default: m.ChartElement })),
)


export function ChartElement(props: ChartProps) {
  // Fallback reserves the chart's eventual height so the page doesn't
  // jump when recharts mounts. `width: 100%` matches the
  // ResponsiveContainer inside chart-impl. height defaults to 200 to
  // mirror chart-impl's default.
  const fallback = (
    <div
      style={{
        width: "100%",
        height: props.height ?? 200,
      }}
      aria-label="Loading chart"
    />
  )
  return (
    <Suspense fallback={fallback}>
      <ChartImpl {...props} />
    </Suspense>
  )
}
