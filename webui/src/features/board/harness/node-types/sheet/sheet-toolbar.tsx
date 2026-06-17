import { useEditorState, type Editor } from "@tiptap/react"
import {
  TextB,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  Highlighter,
} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"


function MarkButton({
  active,
  tooltip,
  onClick,
  children,
}: {
  active?: boolean
  tooltip: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={tooltip}
      aria-label={tooltip}
      data-active={active}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] transition-colors",
        "text-foreground hover:bg-muted",
        active && "bg-secondary text-secondary-foreground",
      )}
    >
      {children}
    </button>
  )
}


/**
 * Formatting bar for the inline sheet card — bold, italic, underline,
 * highlight, strikethrough. Shown only while editing; the modal editor has
 * its own bubble menu. Mount as the card's bottom flex child so it always sits
 * flush at the bottom edge while the prose scrolls above it.
 *
 * The row scrolls horizontally (no wrap, hidden scrollbar) so it
 * truncates gracefully when the note is resized narrow.
 */
export function SheetEditorToolbar({
  editor,
}: {
  editor: Editor
}) {
  const active = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor.isActive("bold"),
      italic: ctx.editor.isActive("italic"),
      underline: ctx.editor.isActive("underline"),
      highlight: ctx.editor.isActive("highlight"),
      strike: ctx.editor.isActive("strike"),
    }),
  })

  return (
    <div
      // Keep the editor's focus + selection when clicking the bar: without
      // preventDefault the editor blurs, collapsing the selection (so the mark
      // applies to nothing) and tripping the blur-to-exit handler.
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "flex shrink-0 items-center gap-0.5 overflow-x-auto border-t border-foreground/20 px-3 py-1 bg-sidebar",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      <MarkButton tooltip="Bold" active={active.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <TextB size={14} weight="bold" />
      </MarkButton>
      <MarkButton tooltip="Italic" active={active.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <TextItalic size={14} />
      </MarkButton>
      <MarkButton tooltip="Underline" active={active.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <TextUnderline size={14} />
      </MarkButton>
      <MarkButton tooltip="Highlight" active={active.highlight} onClick={() => editor.chain().focus().toggleMark("highlight").run()}>
        <Highlighter size={14} />
      </MarkButton>
      <MarkButton tooltip="Strikethrough" active={active.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <TextStrikethrough size={14} />
      </MarkButton>
    </div>
  )
}
