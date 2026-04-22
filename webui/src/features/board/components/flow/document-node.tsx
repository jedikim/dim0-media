import { memo, useMemo } from "react"
import { NodeResizeControl, type ControlPosition, type NodeProps } from "@xyflow/react"
import { PdfIcon } from "@/components/icons"
import type { NoteNode } from "../../types/flow"
import type { DocumentProperties } from "../../types/document"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fontFamilyToTwClass, fontSizeToTwClass, textStyleToTwClass, type Style } from "../../types/style"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { darkModeDisplayHex } from "../../lib/colors/dark-variants"
import { NodeTitleCaption } from "./node-title-caption"


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
  const summary = (data.properties as DocumentProperties)?.summary?.text?.trim()
  const style = data.style as Style | undefined
  const rounded = (style?.roundness ?? 1) > 0 ? "rounded-xl" : "rounded-none"
  const textAlignClass = data.style.textAlign === "left" ? "text-left" : data.style.textAlign === "right" ? "text-right" : "text-center"
  const fontClass = fontFamilyToTwClass(data.style.fontFamily)
  const sizeClass = fontSizeToTwClass(data.style.fontSize)
  const textStyleClass = textStyleToTwClass(data.style.textStyle)

  const displayTextColor = isDark ? darkModeDisplayHex(data.style.textColor) || "#000000" : data.style.textColor
  const captionTextStyle = useMemo(() => ({ color: displayTextColor }), [displayTextColor])

  const className = cn(
    "w-full h-full p-3 text-card-foreground border-2 border-dashed flex flex-col items-center text-center",
    rounded,
    selected ? "border-secondary-foreground" : "border-transparent",
  )

  const content = (
    <div className="relative w-full h-full">
      <div className={className}>
        <div className="flex h-full w-full items-center justify-center">
          <PdfIcon
            className="h-full w-full"
            strokeWidth={1.8}
            color={displayTextColor}
          />
        </div>
      </div>
      <NodeTitleCaption
        nodeId={id}
        label={data.label?.markdown}
        placeholder="Untitled document"
        textClassName={`${textAlignClass} ${fontClass} ${sizeClass} ${textStyleClass}`}
        textStyle={captionTextStyle}
        className="absolute left-1/2 top-full mt-2 w-full -translate-x-1/2"
      />
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
            className={`absolute w-3 h-3 bg-secondary-foreground rounded-full ${className} z-20`}
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
