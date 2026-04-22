import { memo, useMemo } from "react"
import { FolderIcon } from "@/components/icons"
import type { NoteNode } from "../../types/flow"
import { useTheme } from "@/components/theme-provider"
import { darkModeDisplayHex } from "../../lib/colors/dark-variants"
import { isTransparent } from "../../lib/colors/tailwind"
import { fontFamilyToTwClass, fontSizeToTwClass, textStyleToTwClass } from "../../types/style"
import { NodeTitleCaption } from "./node-title-caption"


type FolderNodeProps = {
  id: string
  data: NoteNode["data"]
}


export const FolderNode = memo(function FolderNode({ id, data }: FolderNodeProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const textAlignClass = data.style.textAlign === 'left' ? 'text-left' : data.style.textAlign === 'right' ? 'text-right' : 'text-center'
  const fontClass = fontFamilyToTwClass(data.style.fontFamily)
  const sizeClass = fontSizeToTwClass(data.style.fontSize)
  const textStyleClass = textStyleToTwClass(data.style.textStyle)

  const displayTextColor = useMemo(() => (
    isDark ? darkModeDisplayHex(data.style.textColor) ?? '#e4e4e7' : data.style.textColor
  ), [data.style.textColor, isDark])

  const displayStrokeColor = useMemo(() => {
    if (!isTransparent(data.style.strokeColor)) {
      return isDark ? darkModeDisplayHex(data.style.strokeColor) ?? '#1e1e1e' : data.style.strokeColor
    }

    return displayTextColor
  }, [data.style.strokeColor, displayTextColor, isDark])

  const captionTextStyle = useMemo(() => ({ color: displayTextColor }), [displayTextColor])

  return (
    <div className="relative w-full h-full">
      <div className="flex h-full w-full items-center justify-center">
        <FolderIcon
          className="h-full w-full"
          strokeWidth={1.8}
          color={displayStrokeColor}
        />
      </div>

      <div data-folder-label-edit="true" className="absolute left-1/2 top-full mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={data.label?.markdown}
          placeholder="Untitled folder"
          textClassName={`${textAlignClass} ${fontClass} ${sizeClass} ${textStyleClass}`}
          textStyle={captionTextStyle}
        />
      </div>
    </div>
  )
})
