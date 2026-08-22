import type { Node } from "@canvas-harness/core"
import type { Note, NoteProperties } from "@/features/board/types/note"
import { applyColorsToStyle } from "../theme/color-adapter"
import type { NoteNodeData } from "./note-to-node"
import { asRichLabel } from "@/features/board/model"
import { canvasTypeToDim0 } from "./node-type"
import { canvasStyleToDim0 } from "./style"


const RAD_TO_DEG = 180 / Math.PI


/**
 * Convert a canvas-harness Node back to a Dim0 Note. Inverse of
 * `noteToNode`; data round-tripped via `node.data: NoteNodeData`.
 */
export const nodeToNote = (node: Node): Note => {
  const data = (node.data ?? {}) as Partial<NoteNodeData>
  const extraProperties = data.properties ?? {}
  const groupIds = node.groups as unknown as string[]

  const properties: NoteProperties = {
    nodePosition: { type: "position", position: { x: node.x, y: node.y } },
    nodeSize: { type: "size", size: { width: node.w, height: node.h } },
    nodeZIndex: { type: "number", number: node.z },
    emoji: extraProperties.emoji ?? { type: "icon", icon: { type: "emoji", emoji: "" } },
    pinned: extraProperties.pinned ?? { type: "boolean", boolean: false },
    listOrder: extraProperties.listOrder ?? { type: "number", number: 0 },
    url: extraProperties.url ?? { type: "url" },
    imageUrl: extraProperties.imageUrl ?? { type: "image" },
    iconData: extraProperties.iconData ?? { type: "icon" },
    slideName: extraProperties.slideName,
    slideNumber: extraProperties.slideNumber,
    programmingLanguage: extraProperties.programmingLanguage,
    mimeType: extraProperties.mimeType,
    status: extraProperties.status,
    summary: extraProperties.summary,
    imagePrompt: extraProperties.imagePrompt
      ?? (node.type === "image-generator" ? { type: "text", text: "" } : undefined),
    imageModelId: extraProperties.imageModelId,
    imageAspectRatio: extraProperties.imageAspectRatio,
    imageResolution: extraProperties.imageResolution,
    imageQuality: extraProperties.imageQuality,
    activeGenerationUid: extraProperties.activeGenerationUid,
    imagePendingRequest: extraProperties.imagePendingRequest,
  }

  return {
    id: node.id as unknown as string,
    type: data.noteType ?? "note",
    version: data.version ?? 1,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    graphUid: data.graphUid ?? "",
    parentId: data.parentId,
    minWidth: data.minWidth,
    minHeight: data.minHeight,
    roughSeed: data.roughSeed,
    label: asRichLabel(data.label),
    content: node.content ? { markdown: node.content } : undefined,
    // `node.style.{bg,stroke,text}` may carry dark-mode display values;
    // `_storedColors` holds what the user actually picked. Prefer stored
    // when present so a theme toggle never round-trips adapted colors
    // back to the server. Falls back to `node.style` for legacy nodes
    // that pre-date the field.
    style: canvasStyleToDim0(
      data._storedColors
        ? applyColorsToStyle(node.style ?? {}, data._storedColors)
        : node.style,
      {
        // Prefer the original style.type stashed in data — preserves it
        // across canvas-type overrides (e.g. documents).
        // Image generators deliberately keep the production wire type as
        // rectangle in PR-03. `imagePrompt` is the one-way projection marker,
        // so no backend enum or discriminator schema change is required here.
        type: node.type === "image-generator"
          ? "rectangle"
          : data.styleType ?? canvasTypeToDim0(node.type),
        angle: node.angle * RAD_TO_DEG,
        groupIds,
      },
    ),
    properties,
  }
}
