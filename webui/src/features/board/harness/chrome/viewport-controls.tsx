import { useCallback } from "react"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  DotsNineIcon,
  GridFourIcon,
} from "@phosphor-icons/react"
import {
  useCamera,
  useCanRedo,
  useCanUndo,
  useCanvasStore,
} from "@canvas-harness/react"
import clsx from "clsx"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTheme } from "@/components/theme-provider"
import { darkModeDisplayHex } from "@/features/board/lib/colors/dark-variants"
import { TAILWIND_50 } from "@/features/board/lib/colors/tailwind"
import {
  applyBackgroundAlpha,
  type BoardBackgroundTexture,
} from "@/features/board/utils/board-background"
import { useBoardAppStore } from "../store/board-app-store"


type TextureOption = {
  value: BoardBackgroundTexture | null
  label: string
}


const TEXTURE_OPTIONS: ReadonlyArray<TextureOption> = [
  { value: null, label: "None" },
  { value: "lines", label: "Lines" },
  { value: "dots", label: "Dots" },
]


const BTN_CLASS =
  "inline-flex items-center justify-center rounded-md p-2 text-card-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"


/**
 * Floating viewport controls — bottom-left panel mirroring dim0's
 * react-flow ViewportControls. Wraps zoom %, undo / redo, and a
 * background popover (color picker + texture selector) into a single
 * row. Reads / writes through the canvas-harness store +
 * board-app-store instead of react-flow + graph-store.
 */
export function HarnessViewportControls() {
  const camera = useCamera()
  const store = useCanvasStore()
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const boardBackground = useBoardAppStore((s) => s.boardBackground)
  const boardBackgroundTexture = useBoardAppStore(
    (s) => s.boardBackgroundTexture,
  )
  const setBoardBackground = useBoardAppStore((s) => s.setBoardBackground)
  const setBoardBackgroundTexture = useBoardAppStore(
    (s) => s.setBoardBackgroundTexture,
  )
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const zoomPercent = Math.round((camera?.z ?? 1) * 100)
  const handleResetZoom = useCallback(
    () => store.setCamera({ z: 1 }),
    [store],
  )

  const previewBg =
    applyBackgroundAlpha(
      isDark
        ? (darkModeDisplayHex(boardBackground) ?? boardBackground)
        : boardBackground,
      0.5,
    ) ?? "transparent"

  const colorOptions = [{ name: "white", hex: "#ffffff" }, ...TAILWIND_50].map(
    (option) => ({
      ...option,
      resolved: isDark
        ? (darkModeDisplayHex(option.hex) ?? option.hex)
        : option.hex,
    }),
  )

  return (
    <div className="absolute bottom-3 left-3 z-50">
      {/*
        Container is intentionally chrome-less — transparent, no border
        or shadow. Each button keeps its own hover state for affordance;
        the cluster reads as a row of icons floating over the canvas.
      */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleResetZoom}
              className={BTN_CLASS}
              aria-label="Reset zoom to 100%"
            >
              <span className="min-w-[2.4rem] text-center text-xs font-medium text-secondary-foreground">
                {zoomPercent}%
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Reset zoom</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => store.undo()}
              disabled={!canUndo}
              className={clsx(
                BTN_CLASS,
                !canUndo && "pointer-events-none opacity-50",
              )}
              aria-label="Undo"
            >
              <ArrowCounterClockwiseIcon className="size-4" weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Undo (Cmd/Ctrl+Z)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => store.redo()}
              disabled={!canRedo}
              className={clsx(
                BTN_CLASS,
                !canRedo && "pointer-events-none opacity-50",
              )}
              aria-label="Redo"
            >
              <ArrowClockwiseIcon className="size-4" weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Redo (Cmd/Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={BTN_CLASS}
                  aria-label="Board background"
                >
                  <span
                    className="size-4 rounded-full border-2 border-secondary-foreground/50"
                    style={{ backgroundColor: previewBg }}
                  />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Background style</TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="start" className="w-auto p-2">
            <div className="flex items-center justify-between px-1 text-[11px] font-medium text-muted-foreground">
              <span>Color</span>
              <button
                type="button"
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() => setBoardBackground(null)}
                disabled={!boardBackground}
              >
                Reset
              </button>
            </div>
            <div className="mt-1 grid grid-cols-10 gap-1">
              {colorOptions.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  className="h-5 w-5 rounded-full border border-border shadow-sm transition hover:brightness-95"
                  style={{ backgroundColor: option.resolved }}
                  aria-label={`${option.name}-50`}
                  onClick={() => setBoardBackground(option.hex)}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between px-1 text-[11px] font-medium text-muted-foreground">
              <span>Texture</span>
              <button
                type="button"
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() => setBoardBackgroundTexture(null)}
                disabled={!boardBackgroundTexture}
              >
                Reset
              </button>
            </div>
            <div className="mt-1 flex items-center justify-center gap-1">
              {TEXTURE_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={clsx(
                    "flex h-7 w-7 items-center justify-center rounded-md text-[8px] font-medium transition-colors",
                    option.value === boardBackgroundTexture
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-muted text-muted-foreground/50 hover:bg-muted/70",
                  )}
                  onClick={() => setBoardBackgroundTexture(option.value)}
                  aria-label={option.label}
                >
                  {option.value === "lines" ? (
                    <GridFourIcon className="size-4" />
                  ) : option.value === "dots" ? (
                    <DotsNineIcon className="size-4" />
                  ) : (
                    "None"
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
