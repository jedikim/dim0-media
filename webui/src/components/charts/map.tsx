// React component for the <map> custom element. Pure SVG.
//
// Lazily loads the world atlas (map-geo.ts), then runs the pure projection
// helpers (map-projection.ts) to render a choropleth plus an optional
// marker overlay. While the geometry chunk is in flight it shows a light
// placeholder; a load failure shows an inline message rather than throwing.

import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"

import { loadWorld } from "./map-geo"
import type { WorldGeo } from "./map-geo"
import {
  buildFillResolver,
  buildProjection,
  buildRegionPaths,
  projectMarkers,
} from "./map-projection"
import type { MapProps } from "./map-types"


// viewBox dimensions. ~2:1 matches the Natural Earth aspect ratio, so the
// fitted map nearly fills the box with little letterboxing.
const VIEW_W = 800
const VIEW_H = 400
const REGION_STROKE_WIDTH = 0.5
const MARKER_LABEL_FONT_SIZE = 10


export function MapElement(props: MapProps) {
  const { data = [], markers = [], color = "chart-1", height = 320 } = props
  const [geo, setGeo] = useState<WorldGeo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    loadWorld().then(
      (w) => active && setGeo(w),
      () => active && setFailed(true),
    )
    return () => {
      active = false
    }
  }, [])

  const view = useMemo(() => {
    if (!geo) return null
    const projection = buildProjection(geo.features, VIEW_W, VIEW_H)
    const fillFor = buildFillResolver(data, geo.resolve, color)
    return {
      regions: buildRegionPaths(geo.features, projection, fillFor),
      markers: projectMarkers(markers, projection),
    }
  }, [geo, data, markers, color])

  const style: CSSProperties = {
    width: "100%",
    height,
    display: "block",
  }

  if (failed) {
    return (
      <div className="flex w-full items-center justify-center p-4 text-sm text-muted-foreground" style={{ height }}>
        Map failed to load.
      </div>
    )
  }

  if (!view) {
    return (
      <div className="flex w-full items-center justify-center p-4 text-sm text-muted-foreground" style={{ height }}>
        Loading map…
      </div>
    )
  }

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={style} role="img">
      <g data-map-layer="regions">
        {view.regions.map((r) => (
          <path
            key={r.id}
            data-map-region={r.id}
            d={r.d}
            fill={r.fill}
            stroke="var(--border)"
            strokeWidth={REGION_STROKE_WIDTH}
          />
        ))}
      </g>
      <g data-map-layer="markers">
        {view.markers.map((m, i) => (
          <g key={i}>
            <circle
              cx={m.x}
              cy={m.y}
              r={m.r}
              fill={m.color}
              stroke="var(--background)"
              strokeWidth={1}
            />
            {m.label != null && (
              <text
                x={m.x}
                y={m.y - m.r - 3}
                textAnchor="middle"
                fontSize={MARKER_LABEL_FONT_SIZE}
                fill="var(--foreground)"
              >
                {m.label}
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
  )
}
