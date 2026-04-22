import { memo, useCallback, useMemo } from "react"
import type { MouseEvent } from "react"
import clsx from "clsx"

import { LiteMarkdown } from "@/components/markdown/lite-markdown"
import { DeleteIcon, NotepadIcon, PinIcon, PinOffIcon } from "@/components/icons"

import { useGraphStore } from "../../store/graph-store"
import type { NoteWithPin } from "./note-card"


const TITLE_ROW_PX = 32
const TITLE_FONT_SIZE = 20
const BADGE_GAP = 4
const CARD_PADDING_X = 12
const CARD_PADDING_Y = 10
const BODY_TOP_GAP = 6
const BODY_FONT_SIZE = 14
const BODY_LINE_HEIGHT = 1.35


/**
 * Strips editor-only fence syntax (`:::toggle ...`, `:::`) and collapses blank
 * line runs so the compact preview reads like prose, not raw markup.
 */
function cleanSheetPreview(markdown: string): string {
  if (!markdown) return ""
  const stripped: string[] = []
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim()
    const toggleOpen = trimmed.match(/^:::toggle\s*(.*)$/)
    if (toggleOpen) {
      const summary = toggleOpen[1].trim()
      stripped.push(summary ? `▸ ${summary}` : "▸")
      continue
    }
    if (trimmed.startsWith(":::")) continue
    stripped.push(line)
  }
  const collapsed: string[] = []
  let lastBlank = false
  for (const line of stripped) {
    const isBlank = !line.trim()
    if (isBlank && lastBlank) continue
    collapsed.push(line)
    lastBlank = isBlank
  }
  return collapsed.join("\n").trim()
}


type DocumentCardContentProps = {
  note: NoteWithPin
  isDark: boolean
  textColor?: string
  suspendContent?: boolean
  hideBadge?: boolean
}


/**
 * Title + handwriting body preview for a sheet note. Uses DOM-based lite
 * markdown so the text flows naturally at any container size.
 */
export const DocumentCardContent = memo(function DocumentCardContent({
  note,
  textColor,
  hideBadge = false,
}: DocumentCardContentProps) {
  const title = note.label?.markdown?.trim() || ""
  const body = useMemo(
    () => cleanSheetPreview(note.content?.markdown || ""),
    [note.content?.markdown],
  )

  const paddingTop = hideBadge ? 30 : CARD_PADDING_Y

  return (
    <div
      className="relative z-10 flex flex-col h-full w-full min-w-0"
      style={{
        paddingTop,
        paddingRight: CARD_PADDING_X,
        paddingBottom: CARD_PADDING_Y,
        paddingLeft: CARD_PADDING_X,
        color: textColor,
      }}
    >
      {!hideBadge && (
        <div
          className="flex items-center gap-1 font-handwriting text-foreground/50"
          style={{ fontSize: 12, marginBottom: BADGE_GAP }}
        >
          <NotepadIcon className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="leading-none">Sheet</span>
        </div>
      )}

      <div
        className="font-handwriting font-bold leading-tight truncate"
        style={{ fontSize: TITLE_FONT_SIZE, height: TITLE_ROW_PX }}
      >
        {title || <span className="font-normal italic text-foreground/40">New note</span>}
      </div>

      <div
        className="relative flex-1 min-h-0 min-w-0 overflow-hidden"
        style={{ marginTop: BODY_TOP_GAP }}
      >
        {body && (
          <>
            <div
              className="font-handwriting break-words whitespace-pre-wrap"
              style={{ fontSize: BODY_FONT_SIZE, lineHeight: BODY_LINE_HEIGHT }}
            >
              <LiteMarkdown text={body} />
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
          </>
        )}
      </div>
    </div>
  )
})


type DocumentCardViewProps = {
  note: NoteWithPin
  selected: boolean
  dragging?: boolean
  isDark: boolean
  isPinned: boolean
  textColor?: string
  hideBadge?: boolean
  onTogglePin: (event: MouseEvent<HTMLButtonElement>) => void
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void
  onOpen: () => void
}


/**
 * Paper-styled card used for sheet nodes on the canvas. Wraps DocumentCardContent
 * with the card chrome (texture, shadow, selection ring) and floating hover chips.
 */
export const DocumentCardView = memo(function DocumentCardView({
  note,
  selected,
  dragging,
  isDark,
  isPinned,
  textColor,
  hideBadge,
  onTogglePin,
  onDelete,
  onOpen,
}: DocumentCardViewProps) {
  const isMoving = useGraphStore((state) => state.isMoving)
  const suspendContent = Boolean(isMoving || dragging)

  const handleCardClick = useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("button")) return
    onOpen()
  }, [onOpen])

  return (
    <div
      className={clsx(
        "nodrag group relative w-full h-full cursor-pointer select-none",
        "rounded-lg overflow-hidden",
        "bg-card paper-note-texture",
        !suspendContent && "sticky-note-shadow",
        "transition-shadow",
        selected && "ring-2 ring-secondary-foreground",
        isPinned && !selected && "ring-1 ring-secondary-foreground/40",
      )}
      onClick={handleCardClick}
      style={{ color: textColor }}
    >
      <div
        className={clsx(
          "absolute top-1 right-1 z-30 flex items-center gap-0.5 rounded-full",
          "bg-card/90 backdrop-blur border border-border shadow-sm px-1 py-0.5",
          "opacity-0 pointer-events-none transition-opacity",
          "group-hover:opacity-100 group-hover:pointer-events-auto",
          selected && "opacity-100 pointer-events-auto",
        )}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="p-1 text-foreground/70 hover:text-foreground transition-colors"
          onClick={onTogglePin}
          aria-label="Toggle pin"
          title={isPinned ? "Unpin" : "Pin"}
        >
          {isPinned
            ? <PinIcon className="size-3.5 text-secondary-foreground" strokeWidth={2} />
            : <PinOffIcon className="size-3.5" strokeWidth={2} />
          }
        </button>
        <button
          type="button"
          className="p-1 text-foreground/70 hover:text-destructive transition-colors"
          onClick={onDelete}
          aria-label="Delete note"
          title="Delete"
        >
          <DeleteIcon className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      <DocumentCardContent
        note={note}
        isDark={isDark}
        textColor={textColor}
        suspendContent={suspendContent}
        hideBadge={hideBadge}
      />
    </div>
  )
})
