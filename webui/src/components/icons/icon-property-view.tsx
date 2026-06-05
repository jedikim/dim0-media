import { lazy, Suspense } from "react"
import type { Icon } from "@phosphor-icons/react"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import type { IconProperty } from "@/features/newsfeed/types/properties"
import { resolveIconDisplayColor } from "./icon-color-resolver"


type PhosphorRendererProps = {
  name: string
  color: string
  size: number
}


/**
 * Dynamic-imports the curated icon set on first render. The 261-icon chunk
 * is shared with the lazy picker — once either side has loaded it, every
 * subsequent render of either resolves immediately.
 */
const LazyPhosphorRenderer = lazy(() =>
  import("./picker-set").then((module) => {
    const PhosphorRenderer = ({ name, color, size }: PhosphorRendererProps) => {
      const Glyph = module.PICKER_ICON_MAP.get(name) as Icon | undefined

      if (!Glyph) return null

      return <Glyph size={size} color={color} weight="regular" />
    }

    return { default: PhosphorRenderer }
  }),
)


export type IconPropertyViewProps = {
  icon: IconProperty["icon"] | null | undefined
  size?: number
  className?: string
}


/**
 * Renders an `IconProperty.icon` value at any sheet surface (canvas card,
 * editor header). Phosphor icons go through `LazyPhosphorRenderer` so the
 * curated icon chunk only loads when something actually needs it. Emoji
 * renders as native text. Iconify URLs render as `<img>` for completeness
 * (used by the icon-node feature, not by the sheet picker).
 *
 * Returns `null` when the icon value is empty/unknown so callers can gate
 * their own placeholder UI on whether the icon is present.
 */
export const IconPropertyView = ({ icon, size = 20, className }: IconPropertyViewProps) => {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  if (!icon) return null

  if (icon.type === "phosphor") {
    const color = resolveIconDisplayColor(icon.color, isDark)

    return (
      <span
        className={cn("inline-flex items-center justify-center", className)}
        style={{ width: size, height: size }}
      >
        <Suspense fallback={<IconFallback size={size} />}>
          <LazyPhosphorRenderer name={icon.name} color={color} size={size} />
        </Suspense>
      </span>
    )
  }

  if (icon.type === "emoji") {
    return (
      <span
        className={cn("inline-flex items-center justify-center leading-none", className)}
        style={{ fontSize: size, lineHeight: 1 }}
      >
        {icon.emoji}
      </span>
    )
  }

  return (
    <img
      src={icon.icon}
      alt=""
      className={cn("inline-block", className)}
      style={{ width: size, height: size }}
    />
  )
}


type IconFallbackProps = {
  size: number
}


const IconFallback = ({ size }: IconFallbackProps) => {
  return (
    <span
      aria-hidden="true"
      className="inline-block animate-pulse rounded-sm bg-muted"
      style={{ width: size, height: size }}
    />
  )
}
