import { darkModeDisplayHex } from "@/features/board/lib/colors/dark-variants"


/**
 * Resolves the *display* color for an icon given the stored value and the
 * active mode. Stored hex values get dark-mode adapted via the project's
 * existing Tailwind dark map; CSS variables pass through (the variable
 * itself handles theming); `null`/`undefined` falls back to `currentColor`.
 *
 * The stored value is never mutated — this is a render-time decision.
 */
export const resolveIconDisplayColor = (
  stored: string | null | undefined,
  isDark: boolean,
): string => {
  if (!stored) return "currentColor"
  if (stored.startsWith("var(") || stored.startsWith("--")) return stored
  return isDark ? (darkModeDisplayHex(stored) ?? stored) : stored
}
