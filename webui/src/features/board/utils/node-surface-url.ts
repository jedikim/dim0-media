import { CodeSandboxUrl, MiniAppUrl, SheetUrl, WidgetUrl } from "@/routes"
import type { NodeSurfaceKind } from "../harness/store/board-app-store"


/**
 * Map a node-surface kind to its URL path. The dialog system shares one
 * sub-tree under the board route — only the path segment (`sheets`,
 * `code-sandbox`, `widgets`, `mini-apps`) differs per kind.
 */
export function nodeSurfacePath(kind: NodeSurfaceKind): string {
  switch (kind) {
    case "sheet": return SheetUrl
    case "code-sandbox": return CodeSandboxUrl
    case "widget": return WidgetUrl
    case "mini-app": return MiniAppUrl
  }
}


/**
 * Detect a node-surface kind from a URL pathname. Returns `null` if the
 * pathname doesn't match any of the dialog routes — caller should treat
 * that as "no surface open".
 */
export function nodeSurfaceKindFromPath(pathname: string): NodeSurfaceKind | null {
  if (pathname.includes("/sheets/")) return "sheet"
  if (pathname.includes("/code-sandbox/")) return "code-sandbox"
  if (pathname.includes("/widgets/")) return "widget"
  if (pathname.includes("/mini-apps/")) return "mini-app"
  return null
}
