import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { clsx } from "clsx"

import { Shape } from "../notes/shape"
import { DocumentCardView } from "./document-card-view"
import { CodeSandboxNode } from "./code-sandbox-node"
import { WidgetNode } from "./widget-node"
import { NodeTitleCaption } from "./node-title-caption"
import { NodeCardLabelEditor } from "./node-card-label-editor"
import { useGraphStore } from "../../store/graph-store"
import { darkModeDisplayHex } from "../../lib/colors/dark-variants"
import { fontFamilyToTwClass, fontSizeToTwClass, textStyleToTwClass } from "../../types/style"
import type { Note, NoteProperties } from "../../types/note"


export type NoteWithPin = Note & { pinned?: boolean; autoEdit?: boolean }


type NodeCardProps = {
  note: NoteWithPin
  selected: boolean
  dragging?: boolean
  onLabelEditingChange?: (editing: boolean) => void
  isDark: boolean
  nodeWidth?: number
  nodeHeight?: number
  onCanvasRenderReadyChange?: (ready: boolean) => void
}

type LabelContainerProps = {
  className: string
  textColor?: string
  onDoubleClick?: () => void
  onPointerDown?: (event: React.PointerEvent) => void
  children: React.ReactNode
}


/**
 * Shared wrapper for interactive node content. Both display and edit
 * variants render content inside this container.
 */
export const LabelContainer = memo(function LabelContainer({
  className,
  textColor,
  onDoubleClick,
  onPointerDown,
  children,
}: LabelContainerProps) {
  return (
    <div
      className={className}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      style={{ color: textColor || "inherit" }}
    >
      {children}
    </div>
  )
})


type NoteDisplayContentProps = {
  note: NoteWithPin
  textColor?: string
  nodeWidth?: number
  nodeHeight?: number
  onCanvasRenderReadyChange?: (ready: boolean) => void
}


const noopChange = () => {}


/**
 * Display-only content renderer. Editing variant is owned by
 * <NodeCardLabelEditor> and mounts only when actively editing.
 */
const NoteDisplayContent = memo(function NoteDisplayContent({
  note,
  textColor,
  nodeWidth,
  nodeHeight,
  onCanvasRenderReadyChange,
}: NoteDisplayContentProps) {
  const fontFamily = note.style.fontFamily
  const icon =
    note.properties.iconData?.type === "icon" && note.properties.iconData.icon?.type === "icon"
      ? note.properties.iconData.icon.icon
      : undefined
  const imageUrl = note.properties.imageUrl?.image?.url
  const renderWidth = nodeWidth ?? note.properties.nodeSize?.size?.width
  const renderHeight = nodeHeight ?? note.properties.nodeSize?.size?.height
  const value = note.content?.markdown || note.label?.markdown || ""

  return (
    <Shape
      nodeType={note.style.type}
      value={value}
      labelEditing={false}
      onChange={noopChange}
      textAlign={note.style.textAlign}
      styleHelpers={{
        text: textStyleToTwClass(note.style.textStyle),
        font: fontFamilyToTwClass(fontFamily),
        size: fontSizeToTwClass(note.style.fontSize),
      }}
      icon={icon}
      imageUrl={imageUrl}
      renderWidth={renderWidth}
      renderHeight={renderHeight}
      renderTextColor={textColor}
      renderFontFamily={note.style.fontFamily}
      renderFontSize={note.style.fontSize}
      renderTextStyle={note.style.textStyle}
      onCanvasRenderReadyChange={onCanvasRenderReadyChange}
    />
  )
})


/**
 * Root node card renderer used inside flow nodes. Routes to a variant
 * (sheet / code-sandbox / widget / image / text) and lazily mounts the
 * label editor only when a text/image node is actively being edited.
 */
export const NodeCard = memo(function NodeCard({
  note,
  selected,
  dragging,
  onLabelEditingChange,
  isDark,
  nodeWidth,
  nodeHeight,
  onCanvasRenderReadyChange,
}: NodeCardProps) {
  const isSheet = note.style.type === "sheet"
  const isCodeSandbox = note.style.type === "code-sandbox"
  const isWidget = note.style.type === "widget"
  const isText = note.style.type === "text"
  const isImage = note.style.type === "image"
  const supportsLabelEdit = !isSheet && !isCodeSandbox && !isWidget

  const boardCanEdit = useGraphStore((state) => state.boardCanEdit)
  const [labelEditing, setLabelEditing] = useState(false)

  const textColor = isDark ? darkModeDisplayHex(note.style.textColor) || undefined : note.style.textColor
  const isPinned = note.properties.pinned.boolean === true

  const labelClass = useMemo(
    () =>
      clsx(
        "relative bg-transparent overflow-visible flex items-center justify-center",
        isSheet
          ? "w-full h-full"
          : isText
            ? "w-full h-full p-0"
            : "w-full h-full p-1",
      ),
    [isSheet, isText],
  )

  useEffect(() => {
    onLabelEditingChange?.(labelEditing)
  }, [labelEditing, onLabelEditingChange])

  useEffect(() => {
    if (!selected) {
      setLabelEditing(false)
    }
  }, [selected])

  useEffect(() => {
    if (!isText || !note.autoEdit) return
    setLabelEditing(true)
    useGraphStore.getState().updateNodeByIdPersist(note.id, (node) => ({
      ...node,
      data: {
        ...node.data,
        autoEdit: false,
      },
    }))
  }, [isText, note.autoEdit, note.id])

  const handleStartEdit = useCallback(() => {
    if (supportsLabelEdit) setLabelEditing(true)
  }, [supportsLabelEdit])

  const handleTogglePin = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    useGraphStore.getState().updateNodeByIdPersist(note.id, (node) => {
      const props = node.data.properties as NoteProperties
      return {
        ...node,
        data: {
          ...node.data,
          properties: {
            ...props,
            pinned: { type: "boolean", boolean: !isPinned },
          },
        },
      }
    })
  }, [isPinned, note.id])

  const handleDelete = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    const store = useGraphStore.getState()
    store.setNodesPersist((nodes) => nodes.filter((node) => node.id !== note.id))
    store.setEdgesPersist((edges) => edges.filter((edge) => edge.source !== note.id && edge.target !== note.id))
  }, [note.id])

  const handleOpenSheet = useCallback(() => {
    if (!boardCanEdit) return
    useGraphStore.getState().openNodeSurface(note.id, "sheet")
  }, [boardCanEdit, note.id])

  if (isSheet) {
    return (
      <LabelContainer
        className={labelClass}
        textColor={textColor}
      >
        <DocumentCardView
          note={note}
          selected={selected}
          dragging={dragging}
          isDark={isDark}
          isPinned={isPinned}
          textColor={textColor}
          onTogglePin={handleTogglePin}
          onDelete={handleDelete}
          onOpen={handleOpenSheet}
        />
      </LabelContainer>
    )
  }

  if (isCodeSandbox) {
    return (
      <LabelContainer
        className={labelClass}
        textColor={textColor}
      >
        <CodeSandboxNode note={note} dragging={dragging} />
      </LabelContainer>
    )
  }

  if (isWidget) {
    return (
      <LabelContainer
        className={labelClass}
        textColor={textColor}
      >
        <WidgetNode note={note} selected={selected} dragging={dragging} />
      </LabelContainer>
    )
  }

  // Image and text branches: editing is gated, so the editor mounts only
  // when actively in edit mode and unmounts otherwise.
  if (labelEditing) {
    return (
      <NodeCardLabelEditor
        note={note}
        selected={selected}
        isImage={isImage}
        textColor={textColor}
        labelClass={labelClass}
        nodeWidth={nodeWidth}
        nodeHeight={nodeHeight}
        onCanvasRenderReadyChange={onCanvasRenderReadyChange}
      />
    )
  }

  if (isImage) {
    return (
      <LabelContainer
        className={labelClass}
        textColor={textColor}
        onDoubleClick={handleStartEdit}
      >
        <div className="group relative flex h-full w-full items-center justify-center overflow-visible">
          <NoteDisplayContent
            note={note}
            textColor={textColor}
            nodeWidth={nodeWidth}
            nodeHeight={nodeHeight}
            onCanvasRenderReadyChange={onCanvasRenderReadyChange}
          />
          <ImageCaptionOverlay note={note} selected={selected} />
        </div>
      </LabelContainer>
    )
  }

  return (
    <LabelContainer
      className={labelClass}
      textColor={textColor}
      onDoubleClick={handleStartEdit}
    >
      <NoteDisplayContent
        note={note}
        textColor={textColor}
        nodeWidth={nodeWidth}
        nodeHeight={nodeHeight}
        onCanvasRenderReadyChange={onCanvasRenderReadyChange}
      />
    </LabelContainer>
  )
})


type ImageCaptionOverlayProps = {
  note: Note
  selected: boolean
}


/**
 * Caption rendered below an image node. Hidden by default; revealed on hover,
 * when the node is selected, or while the caption is being edited.
 */
export const ImageCaptionOverlay = memo(function ImageCaptionOverlay({
  note,
  selected,
}: ImageCaptionOverlayProps) {
  const [editing, setEditing] = useState(false)
  const reveal = selected || editing

  return (
    <NodeTitleCaption
      nodeId={note.id}
      label={note.label?.markdown}
      placeholder="Add caption…"
      onEditingChange={setEditing}
      textClassName="text-center text-sm font-medium text-foreground"
      emptyTextClassName="text-center text-sm text-muted-foreground italic"
      maxLines={3}
      className={clsx(
        "pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2 transition-opacity",
        reveal ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    />
  )
})
