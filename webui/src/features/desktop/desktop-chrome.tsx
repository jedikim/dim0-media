import { useEffect, useRef, useState } from "react"
import type { Window } from "@tauri-apps/api/window"
import { cn } from "@/lib/utils"


/**
 * App identity for the desktop title bar — the Dim0 tree mark + wordmark, mirroring
 * the web sidebar header. `pointer-events-none` so it's part of the drag region
 * (mousedown falls through to the bar, which carries `data-tauri-drag-region`).
 */
export const DesktopBrand = () => (
  <div className="pointer-events-none flex select-none items-center gap-1.5">
    <img src="/dim0.svg" alt="" className="size-5 shrink-0" />
    <span className="text-sm font-semibold text-foreground">Dim0</span>
  </div>
)


/**
 * Crisp 10×10 window-control glyphs — hand-drawn rather than Phosphor on purpose:
 * window controls want thin, pixel-aligned (`crispEdges`) strokes that read as OS
 * chrome, not the rounded content icons Phosphor provides.
 */
const Glyph = ({ children }: { children: React.ReactNode }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1} shapeRendering="crispEdges">
    {children}
  </svg>
)


const ControlButton = ({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={cn(
      "flex h-8 w-11 items-center justify-center text-muted-foreground transition-colors",
      danger ? "hover:bg-red-500 hover:text-white" : "hover:bg-foreground/10 hover:text-foreground",
    )}
  >
    {children}
  </button>
)


/**
 * Custom minimize / maximize / close controls for the frameless desktop window
 * (`decorations: false`). Rendered top-right on every OS for a consistent look —
 * there are no native controls to defer to. Grabs the Tauri window lazily so this
 * module never touches the native API on the web build; a no-op until it resolves.
 */
export const WindowControls = () => {
  const winRef = useRef<Window | null>(null)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        if (cancelled) return
        const win = getCurrentWindow()
        winRef.current = win
        const sync = (): void => void win.isMaximized().then((m) => setMaximized(m)).catch(() => {})
        sync()
        const un = await win.onResized(sync)
        if (cancelled) un()
        else unlisten = un
      })
      // Listen setup can reject (permission/teardown); the glyph just stops
      // tracking state — don't leave an unhandled rejection.
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return (
    // Not a drag region — these are interactive. Kept slightly inset from the
    // rounded window corner rather than flush to the edge.
    <div className="flex items-center self-stretch">
      <ControlButton label="Minimize" onClick={() => void winRef.current?.minimize()}>
        <Glyph>
          <line x1={0} y1={5} x2={10} y2={5} />
        </Glyph>
      </ControlButton>
      <ControlButton
        label={maximized ? "Restore" : "Maximize"}
        onClick={() => void winRef.current?.toggleMaximize()}
      >
        {maximized ? (
          <Glyph>
            <rect x={0.5} y={2.5} width={7} height={7} />
            <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" />
          </Glyph>
        ) : (
          <Glyph>
            <rect x={0.5} y={0.5} width={9} height={9} />
          </Glyph>
        )}
      </ControlButton>
      <ControlButton label="Close" danger onClick={() => void winRef.current?.close()}>
        <Glyph>
          <line x1={0.5} y1={0.5} x2={9.5} y2={9.5} />
          <line x1={9.5} y1={0.5} x2={0.5} y2={9.5} />
        </Glyph>
      </ControlButton>
    </div>
  )
}
