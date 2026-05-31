import { TAILWIND_HEX } from "@/features/board/lib/colors/tailwind"
import { darkModeDisplayHex } from "@/features/board/lib/colors/dark-variants"


// The neutral / desaturated families read as "no color" once warmed by
// the paper anchor — useless for distinguishing one tag from another.
// Restrict the hash bucket to the chromatic families so every tag gets
// a colour that actually communicates identity.
const NEUTRAL_FAMILIES = new Set([
  "slate",
  "gray",
  "stone",
  "neutral",
  "zinc",
  "brown",
])


const CHROMATIC_FAMILIES = Object.keys(TAILWIND_HEX).filter(
  (family) => !NEUTRAL_FAMILIES.has(family),
)


/**
 * Stable, order-independent hash. djb2 with the standard 33 multiplier.
 * Same input → same uint32, so the same tag value always picks the same
 * family across reloads and across devices.
 */
function hashTagValue(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  // Force unsigned so the modulo below behaves on negative-looking ints.
  return hash >>> 0
}


export interface TagColors {
  background: string
  foreground: string
}


/**
 * Resolve background + foreground hexes for a tag chip, derived
 * deterministically from the tag value. Dark mode reuses the existing
 * paper-anchored light → dark mapping so chips visually rhyme with the
 * rest of the dark theme instead of being raw Tailwind shades.
 */
export function getTagColor(value: string, isDark: boolean): TagColors {
  const family = CHROMATIC_FAMILIES[hashTagValue(value) % CHROMATIC_FAMILIES.length]
  const bgLight = TAILWIND_HEX[family]?.[200]
  const fgLight = TAILWIND_HEX[family]?.[800]
  if (!bgLight || !fgLight) {
    // Defensive fallback — paper-adapted palette should always resolve,
    // but keep the chip readable if a family table is ever incomplete.
    return { background: "var(--card)", foreground: "var(--foreground)" }
  }
  if (!isDark) {
    return { background: bgLight, foreground: fgLight }
  }
  return {
    background: darkModeDisplayHex(bgLight) ?? bgLight,
    foreground: darkModeDisplayHex(fgLight) ?? fgLight,
  }
}
