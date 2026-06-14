// Lazy geometry loader + region resolver for the <map> element.
//
// The world atlas (~38kb gzip) is dynamic-imported so it ships as its own
// chunk, fetched only when a map actually mounts — not in the base runtime.
// That's a same-origin script load, allowed under the sandbox CSP
// (`script-src 'self'`); it is NOT a network `fetch`, so `connect-src
// 'none'` doesn't block it. The result is cached module-side so repeated
// mounts pay the cost once.

import { feature } from "topojson-client"
import type { Feature, Geometry, GeoJsonProperties } from "geojson"


export interface WorldGeo {
  features: Feature<Geometry, GeoJsonProperties>[]
  // Friendly region key (name / ISO numeric) → atlas numeric id, or null.
  resolve: (key: string) => string | null
}


// Common aliases and abbreviations → the atlas's English name (normalized).
// Exact-name matching covers most countries; this handles the inputs an
// LLM is likely to emit that don't match Natural Earth's naming.
const ALIASES: Record<string, string> = {
  us: "united states of america",
  usa: "united states of america",
  "united states": "united states of america",
  america: "united states of america",
  uk: "united kingdom",
  britain: "united kingdom",
  "great britain": "united kingdom",
  england: "united kingdom",
  uae: "united arab emirates",
  "russian federation": "russia",
  korea: "south korea",
  "republic of korea": "south korea",
  drc: "dem rep congo",
  "dr congo": "dem rep congo",
  "democratic republic of the congo": "dem rep congo",
  "czech republic": "czechia",
  burma: "myanmar",
}


let worldPromise: Promise<WorldGeo> | null = null


/** Load (and cache) the world atlas, returning its features + a resolver. */
export function loadWorld(): Promise<WorldGeo> {
  if (!worldPromise) worldPromise = importWorld()
  return worldPromise
}


async function importWorld(): Promise<WorldGeo> {
  const topology = (await import("world-atlas/countries-110m.json")).default as {
    objects: { countries: unknown }
  }
  const fc = feature(topology, topology.objects.countries)
  const features = fc.features

  const ids = new Set<string>()
  const byName = new Map<string, string>()
  for (const f of features) {
    const id = String(f.id ?? "")
    if (!id) continue
    ids.add(id)
    const name = f.properties?.name
    if (typeof name === "string") byName.set(normalize(name), id)
  }

  const resolve = (key: string): string | null => {
    const raw = key.trim()
    // Numeric ISO code passthrough.
    if (/^\d+$/.test(raw) && ids.has(raw)) return raw
    const n = normalize(raw)
    const direct = byName.get(n)
    if (direct) return direct
    const aliased = ALIASES[n]
    if (aliased) {
      const id = byName.get(aliased)
      if (id) return id
    }
    return null
  }

  return { features, resolve }
}


/** Lowercase, drop punctuation and a leading "the", collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
}
