// Local ambient declarations for the geo packages the <map> element uses.
//
// We deliberately don't rely on @types/topojson-client: its type entry
// imports from `topojson-specification`, which isn't available in this
// registry, so pulling it in breaks type-check. We only need `feature()`
// (TopoJSON → GeoJSON), so a one-line signature is enough.
//
// The JSON declaration lets us dynamic-import the world atlas without
// enabling resolveJsonModule project-wide. The atlas is loaded lazily
// (see map-geo.ts) so it ships as its own chunk, not in the base runtime.

declare module "topojson-client" {
  import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson"

  export function feature(
    topology: unknown,
    object: unknown,
  ): FeatureCollection<Geometry, GeoJsonProperties>
}


declare module "world-atlas/countries-110m.json" {
  const topology: unknown
  export default topology
}
