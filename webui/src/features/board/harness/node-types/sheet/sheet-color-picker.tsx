import { useRef } from "react"
import { PaletteIcon } from "@phosphor-icons/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTheme } from "@/components/theme-provider"
import { darkModeDisplayHex } from "@/features/board/lib/colors/dark-variants"
import { buildPalette, isSameColor } from "@/features/board/lib/colors/tailwind"
import { cn } from "@/lib/utils"
import { KeySwatch } from "../../chrome/style-panel/key-swatch"
import { useStopCanvasGesture } from "../../shared-views"


/** Sheet backgrounds are restricted to the Tailwind shade-100 family. */
const SHADE_100 = buildPalette(100)


type SheetColorPickerProps = {
  /** Canonical (light-space) bg hex when a shade-100 color is set; null = default card. */
  value: string | null
  /** Picks a shade-100 hex, or null to fall back to the default card surface. */
  onPick: (hexOrNull: string | null) => void
}


/**
 * Compact background-color picker for the sheet card. Offers a "Default"
 * (card surface) reset plus the Tailwind shade-100 palette — deliberately
 * narrow so a sheet can never take a dark/saturated fill. The chosen hex
 * still rides on `style.backgroundColor`; the sheet view gates rendering
 * on shade-100 membership, so this never pollutes the shared style memory.
 */
export function SheetColorPicker({ value, onPick }: SheetColorPickerProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  // Preview the dot the way the canvas paints it — dark-adapted in dark mode,
  // matching the card fill and the grid swatches.
  const previewHex = value && isDark ? darkModeDisplayHex(value) ?? value : value
  // The trigger sits inside the node's bounding box; without this the canvas
  // gesture hook captures pointerdown and the click never fires.
  const triggerRef = useRef<HTMLButtonElement>(null)
  useStopCanvasGesture(triggerRef)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label="Background color"
          title="Background color"
          className={cn(
            "pointer-events-auto flex size-6 items-center justify-center rounded-full",
            "border border-border/60 bg-card/80 text-muted-foreground shadow-sm backdrop-blur",
            "transition-colors hover:text-foreground",
          )}
        >
          {previewHex ? (
            <span
              className="size-3.5 rounded-full border border-border/60"
              style={{ backgroundColor: previewHex }}
            />
          ) : (
            <PaletteIcon className="size-3.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[200px] p-3"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onPick(null)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
              value === null
                ? "border-secondary-foreground bg-muted/40 text-foreground"
                : "border-border/60 text-muted-foreground hover:bg-muted/30 hover:text-foreground",
            )}
          >
            <span className="size-4 rounded-sm border border-border/60 bg-card" />
            Default
          </button>
          <div className="grid grid-cols-6 gap-1">
            {SHADE_100.map((c) => (
              <KeySwatch
                key={c.name}
                color={c.hex}
                selected={isSameColor(value, c.hex)}
                onClick={() => onPick(c.hex)}
                isDark={isDark}
                size="dot"
                hideLabel
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
