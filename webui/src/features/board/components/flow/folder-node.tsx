import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Folder01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { NoteNode } from "../../types/flow"
import { useGraphStore } from "../../store/graph-store"
import { useTheme } from "@/components/theme-provider"
import { darkModeDisplayHex } from "../../lib/colors/dark-variants"
import { isTransparent } from "../../lib/colors/tailwind"
import { fontFamilyToTwClass, fontSizeToTwClass, textStyleToTwClass } from "../../types/style"


type FolderNodeProps = {
  id: string
  data: NoteNode["data"]
}


const normalizeLabel = (markdown?: string) => {
  const text = (markdown ?? "").replace(/\s+/g, " ").trim()
  return text || "Untitled folder"
}


export const FolderNode = memo(function FolderNode({ id, data }: FolderNodeProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const updateNodeByIdPersist = useGraphStore(state => state.updateNodeByIdPersist)
  const [labelEditing, setLabelEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(data.label?.markdown || "")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const displayLabel = normalizeLabel(data.label?.markdown)
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

  useEffect(() => {
    if (labelEditing) return
    setLabelDraft(data.label?.markdown || "")
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
    const prev = data.label?.markdown?.trim() || ""
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
    else setLabelDraft(data.label?.markdown || "")
    setLabelEditing(false)
  }, [commitLabel, data.label?.markdown, labelDraft])

  return (
    <div className="relative w-full h-full">
      <div className="flex h-full w-full items-center justify-center">
        <HugeiconsIcon
          icon={Folder01Icon}
          className="h-full w-full"
          strokeWidth={1.8}
          color={displayStrokeColor}
        />
      </div>

      <div className="absolute left-1/2 top-full mt-2 w-full -translate-x-1/2 max-w-[220px]">
        {labelEditing ? (
          <input
            data-folder-label-edit="true"
            ref={inputRef}
            value={labelDraft}
            onChange={event => setLabelDraft(event.target.value)}
            onBlur={() => stopLabelEdit(true)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault()
                stopLabelEdit(true)
              }
              if (event.key === "Escape") {
                event.preventDefault()
                stopLabelEdit(false)
              }
            }}
            onMouseDown={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            className={`w-full bg-transparent border-0 border-b border-foreground/30 focus:border-secondary focus:outline-none px-0 py-0.5 ${textAlignClass} ${fontClass} ${sizeClass} ${textStyleClass}`}
            style={{ color: displayTextColor }}
            placeholder="Untitled folder"
          />
        ) : (
          <button
            type="button"
            data-folder-label-edit="true"
            onClick={event => {
              event.stopPropagation()
              setLabelEditing(true)
            }}
            onDoubleClick={event => event.stopPropagation()}
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
})
