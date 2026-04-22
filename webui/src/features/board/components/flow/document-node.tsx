import { memo, useCallback, useEffect, useRef, useState } from "react"
import { NodeResizeControl, type ControlPosition, type NodeProps } from "@xyflow/react"
import { Pdf02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { NoteNode } from "../../types/flow"
import type { DocumentProperties } from "../../types/document"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fontFamilyToTwClass, fontSizeToTwClass, textStyleToTwClass, type Style } from "../../types/style"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { darkModeDisplayHex } from "../../lib/colors/dark-variants"
import { useGraphStore } from "../../store/graph-store"


type ResizeHandle = {
  pos: ControlPosition
  className: string
}


const RESIZE_HANDLES: ResizeHandle[] = [
  { pos: "top-left", className: "top-0 left-0 cursor-nwse-resize" },
  { pos: "top-right", className: "top-0 right-0 cursor-nesw-resize" },
  { pos: "bottom-left", className: "bottom-0 left-0 cursor-nesw-resize" },
  { pos: "bottom-right", className: "bottom-0 right-0 cursor-nwse-resize" },
]


const getHandleTransform = (pos: ControlPosition) => {
  const x = pos.includes("right") ? "50%" : "-50%"
  const y = pos.includes("bottom") ? "50%" : "-50%"
  return `translate(${x}, ${y})`
}


/**
 * A React component that renders a document node within a flow board.
 */
export const DocumentNode = memo(function DocumentNode({ id, data, selected }: NodeProps<NoteNode>) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const updateNodeByIdPersist = useGraphStore(state => state.updateNodeByIdPersist)
  const [labelEditing, setLabelEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(data.label?.markdown || '')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const label = data.label?.markdown?.trim()
  const summary = (data.properties as DocumentProperties)?.summary?.text?.trim()
  const displayLabel = label || "Untitled document"
  const style = data.style as Style | undefined
  const rounded = (style?.roundness ?? 1) > 0 ? "rounded-xl" : "rounded-none"
  const textAlignClass = data.style.textAlign === "left" ? "text-left" : data.style.textAlign === "right" ? "text-right" : "text-center"
  const fontClass = fontFamilyToTwClass(data.style.fontFamily)
  const sizeClass = fontSizeToTwClass(data.style.fontSize)
  const textStyleClass = textStyleToTwClass(data.style.textStyle)

  const displayTextColor = isDark ? darkModeDisplayHex(data.style.textColor) || "#000000" : data.style.textColor

  useEffect(() => {
    if (labelEditing) return
    setLabelDraft(data.label?.markdown || '')
  }, [data.label?.markdown, labelEditing])

  useEffect(() => {
    if (!labelEditing) return
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [labelEditing])

  const commitLabel = useCallback((nextRaw: string) => {
    const next = nextRaw.trim()
    const prev = data.label?.markdown?.trim() || ''
    if (next === prev) return
    updateNodeByIdPersist(id, prevNode => ({
      ...prevNode,
      data: {
        ...prevNode.data,
        label: next ? { markdown: next } : undefined,
      },
    }))
  }, [data.label?.markdown, id, updateNodeByIdPersist])

  const stopLabelEdit = useCallback((save: boolean) => {
    if (save) commitLabel(labelDraft)
    else setLabelDraft(data.label?.markdown || '')
    setLabelEditing(false)
  }, [commitLabel, data.label?.markdown, labelDraft])

  const className = cn(
    "w-full h-full p-3 text-card-foreground border-2 border-dashed flex flex-col items-center text-center",
    rounded,
    selected ? "border-secondary" : "border-transparent",
  )

  const content = (
    <div className="relative w-full h-full">
      <div className={className}>
        <div className="flex h-full w-full items-center justify-center">
          <HugeiconsIcon
            icon={Pdf02Icon}
            className="h-full w-full"
            strokeWidth={1.8}
            color={displayTextColor}
          />
        </div>
      </div>
      <div
        className={`absolute left-1/2 top-full mt-2 w-full -translate-x-1/2 line-clamp-2 break-words max-w-[220px] overflow-ellipsis ${textAlignClass} ${fontClass} ${sizeClass} ${textStyleClass}`}
        style={{ color: displayTextColor }}
      >
        {labelEditing ? (
          <input
            ref={inputRef}
            value={labelDraft}
            onChange={event => setLabelDraft(event.target.value)}
            onBlur={() => stopLabelEdit(true)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                stopLabelEdit(true)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                stopLabelEdit(false)
              }
            }}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            className={`w-full bg-transparent border-0 border-b border-foreground/30 focus:border-secondary focus:outline-none px-0 py-0.5 ${textAlignClass} ${fontClass} ${sizeClass} ${textStyleClass}`}
            style={{ color: displayTextColor }}
            placeholder='Untitled document'
          />
        ) : (
          <button
            type='button'
            onClick={event => {
              event.stopPropagation()
              setLabelEditing(true)
            }}
            className={`block w-full truncate hover:underline ${textAlignClass} ${fontClass} ${sizeClass} ${textStyleClass}`}
            style={{ color: displayTextColor }}
            title={displayLabel}
            aria-label={displayLabel}
          >
            {displayLabel}
          </button>
        )}
      </div>
    </div>
  )

  const contentWithResizeHandles = (
    <div className="relative w-full h-full overflow-visible">
      {content}
      {selected && RESIZE_HANDLES.map(({ pos, className }) => (
        <NodeResizeControl
          key={pos}
          position={pos}
          minWidth={80}
          minHeight={80}
          keepAspectRatio
        >
          <div
            className={`absolute w-3 h-3 bg-secondary rounded-full ${className} z-20`}
            style={{ transform: getHandleTransform(pos) }}
          />
        </NodeResizeControl>
      ))}
    </div>
  )

  if (!summary) {
    return contentWithResizeHandles
  }

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        {contentWithResizeHandles}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="max-w-72">
        <p className="text-xs leading-relaxed">{summary}</p>
      </TooltipContent>
    </Tooltip>
  )
})
