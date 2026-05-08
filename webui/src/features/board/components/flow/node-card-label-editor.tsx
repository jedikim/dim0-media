import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { Shape } from "../notes/shape"
import { useGraphStore } from "../../store/graph-store"
import { fontFamilyToTwClass, fontSizeToTwClass, textStyleToTwClass } from "../../types/style"
import { ImageCaptionOverlay, LabelContainer, type NoteWithPin } from "./note-card"


type NodeCardLabelEditorProps = {
  note: NoteWithPin
  selected: boolean
  isImage: boolean
  textColor?: string
  labelClass: string
  nodeWidth?: number
  nodeHeight?: number
  onCanvasRenderReadyChange?: (ready: boolean) => void
}


/**
 * Owns inline label editing state, focus, debounced commit, and cursor
 * restoration. Mounted only while a node is actively being edited so the
 * heavy hook setup never runs on the ~99% of nodes in display mode.
 */
export const NodeCardLabelEditor = memo(function NodeCardLabelEditor({
  note,
  selected,
  isImage,
  textColor,
  labelClass,
  nodeWidth,
  nodeHeight,
  onCanvasRenderReadyChange,
}: NodeCardLabelEditorProps) {
  const initialValue = note.content?.markdown || note.label?.markdown || ""
  const [labelDraft, setLabelDraft] = useState<string>(initialValue)
  const [debouncedLabelDraft, setDebouncedLabelDraft] = useState<string>(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selRef = useRef<{ start: number; end: number } | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedLabelDraft(labelDraft)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [labelDraft])

  useEffect(() => {
    if (debouncedLabelDraft === initialValue) return
    useGraphStore.getState().updateNodeByIdPersist(note.id, (node) => ({
      ...node,
      data: {
        ...node.data,
        content: { markdown: debouncedLabelDraft },
      },
    }))
    // initialValue is captured once at mount; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedLabelDraft, note.id])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.focus()
    const length = element.value.length
    try {
      element.setSelectionRange(length, length)
    } catch {
      console.warn("Failed to set selection range")
    }
  }, [])

  useLayoutEffect(() => {
    const element = textareaRef.current
    const selection = selRef.current
    if (!element || !selection) return

    const restore = () => {
      try {
        element.setSelectionRange(selection.start, selection.end)
      } catch {
        console.warn("Failed to restore selection range")
      }
    }
    restore()
    const frameId = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frameId)
  }, [labelDraft])

  const handleLabelChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value
    selRef.current = {
      start: event.target.selectionStart ?? next.length,
      end: event.target.selectionEnd ?? next.length,
    }
    setLabelDraft(next)
  }, [])

  const stopDragging = useCallback((event: React.PointerEvent) => {
    event.stopPropagation()
  }, [])

  const fontFamily = note.style.fontFamily
  const icon =
    note.properties.iconData?.type === "icon" && note.properties.iconData.icon?.type === "icon"
      ? note.properties.iconData.icon.icon
      : undefined
  const imageUrl = note.properties.imageUrl?.image?.url
  const renderWidth = nodeWidth ?? note.properties.nodeSize?.size?.width
  const renderHeight = nodeHeight ?? note.properties.nodeSize?.size?.height

  const content = (
    <Shape
      nodeType={note.style.type}
      value={labelDraft}
      labelEditing={true}
      onChange={handleLabelChange}
      textareaRef={textareaRef}
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

  return (
    <LabelContainer
      className={labelClass}
      textColor={textColor}
      onPointerDown={stopDragging}
    >
      {isImage ? (
        <div className="group relative flex h-full w-full items-center justify-center overflow-visible">
          {content}
          <ImageCaptionOverlay note={note} selected={selected} />
        </div>
      ) : content}
    </LabelContainer>
  )
})
