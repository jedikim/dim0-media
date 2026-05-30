import { memo } from "react"
import { worldToScreen } from "@canvas-harness/core"
import { useCamera, usePresence } from "@canvas-harness/react"


/**
 * Render every remote peer's cursor + name label on top of the
 * canvas. Reads `usePresence()` for the live map of remote clients
 * and `useCamera()` to project world → screen each frame.
 *
 * Cursor rendering is pure overlay — no canvas hits, no selection.
 * If a peer's `cursor` is null (they've left the surface) we skip them.
 *
 * Transport-agnostic — only reads from `store.presence`, which the WS
 * adapter (`use-ws-collab`) populates.
 */
export const RemoteCursors = memo(function RemoteCursors() {
  const camera = useCamera()
  const remotes = usePresence()

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {[...remotes.values()].map((peer) => {
        if (!peer.cursor) return null
        const { x, y } = worldToScreen(peer.cursor, camera)
        return (
          <div
            key={peer.clientId as unknown as string}
            className="absolute"
            style={{
              left: 0,
              top: 0,
              transform: `translate(${x}px, ${y}px)`,
              color: peer.color,
            }}
          >
            <CursorGlyph color={peer.color} />
            {peer.name ? (
              <span
                className="absolute top-4 left-3 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium text-white shadow-sm"
                style={{ backgroundColor: peer.color }}
              >
                {peer.name}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
})


/** Standard arrow-cursor SVG, colorable via `currentColor`. */
const CursorGlyph = ({ color }: { color: string }) => (
  <svg
    width="16"
    height="20"
    viewBox="0 0 16 20"
    fill="none"
    style={{ color }}
    aria-hidden="true"
  >
    <path
      d="M 1.5 1 L 14 12 L 8 13 L 11 19 L 8.5 20 L 5.5 14 L 1 17 Z"
      fill="currentColor"
      stroke="white"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)
