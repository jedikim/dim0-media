import { codeSandboxDef } from "./code-sandbox"
import { documentDef } from "./document"
import { folderDef } from "./folder"
import { generatedImageDef } from "./generated-image"
import { imageGeneratorDef } from "./image-generator"
import { miniAppDef } from "./mini-app"
import { sheetDef } from "./sheet"
import { widgetDef } from "./widget"
import type { BoardNodeTypeDef } from "../store/create-board-store"


/**
 * Array of all custom node defs registered with the board's
 * canvas-harness store. Pass directly to `createBoardStore({ nodeTypes })`.
 */
export const boardNodeTypes: ReadonlyArray<BoardNodeTypeDef> = [
  folderDef,
  generatedImageDef,
  imageGeneratorDef,
  documentDef,
  widgetDef,
  miniAppDef,
  codeSandboxDef,
  sheetDef,
]


export { codeSandboxDef, CodeSandboxView } from "./code-sandbox"
export { documentDef, DocumentView } from "./document"
export { folderDef, FolderView } from "./folder"
export { generatedImageDef, GeneratedImageView } from "./generated-image"
export { imageGeneratorDef, ImageGeneratorView } from "./image-generator"
export { miniAppDef, MiniAppView } from "./mini-app"
export { sheetDef, SheetView } from "./sheet"
export { widgetDef, WidgetView } from "./widget"
export { useRenderCustomNodeView } from "./render-view"
