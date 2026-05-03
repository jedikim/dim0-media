import { useEditorState } from "@tiptap/react"
import type { Editor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import {
  TextB,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  Code,
  Link,
  Quotes,
  NotePencilIcon,
  Eraser,
} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { HIGHLIGHT_COLORS } from "./highlight/highlight-extension"

type Props = { editor: Editor }

function BBtn({
  onClick,
  active,
  tooltip,
  children,
}: {
  onClick: () => void
  active?: boolean
  tooltip: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={tooltip}
      onClick={onClick}
      data-active={active}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] transition-colors",
        "text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-secondary text-secondary-foreground",
      )}
    >
      {children}
    </button>
  )
}

function BDivider() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
}


function HighlightPicker({ editor, active }: { editor: Editor; active: boolean }) {
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Highlight"
          data-active={active}
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            active && "bg-secondary text-secondary-foreground",
          )}
        >
          <NotePencilIcon size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        className="flex w-auto items-center gap-1 p-1.5"
      >
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              editor.chain().focus().setMark("highlight", { color }).run()
            }
            className="size-5 shrink-0 rounded-md border border-border/60 transition-transform hover:scale-110"
            style={{ background: `var(--hl-${color})` }}
          />
        ))}
        <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
        <button
          type="button"
          title="Remove highlight"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            editor.chain().focus().unsetMark("highlight").run()
          }
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Eraser size={12} />
        </button>
      </PopoverContent>
    </Popover>
  )
}

export function EditorBubbleMenu({ editor }: Props) {
  const s = useEditorState({
    editor,
    selector: (ctx) => ({
      isBold: ctx.editor.isActive("bold"),
      isItalic: ctx.editor.isActive("italic"),
      isUnderline: ctx.editor.isActive("underline"),
      isStrike: ctx.editor.isActive("strike"),
      isCode: ctx.editor.isActive("code"),
      isLink: ctx.editor.isActive("link"),
      isHighlight: ctx.editor.isActive("highlight"),
      isBlockquote: ctx.editor.isActive("blockquote"),
      isH1: ctx.editor.isActive("heading", { level: 1 }),
      isH2: ctx.editor.isActive("heading", { level: 2 }),
      isH3: ctx.editor.isActive("heading", { level: 3 }),
    }),
  })

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) =>
        !e.isActive("tableCell") && !e.isActive("tableHeader") &&
        !state.selection.empty
      }
      options={{ placement: "top" }}
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-border/70 bg-card px-1 py-0.5",
        "shadow-md",
      )}
    >
      {/* ── marks ────────────────────────────────────────────── */}
      <BBtn
        tooltip="Bold"
        active={s.isBold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <TextB size={14} weight="bold" />
      </BBtn>
      <BBtn
        tooltip="Italic"
        active={s.isItalic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <TextItalic size={14} />
      </BBtn>
      <BBtn
        tooltip="Underline"
        active={s.isUnderline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <TextUnderline size={14} />
      </BBtn>
      <BBtn
        tooltip="Strikethrough"
        active={s.isStrike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <TextStrikethrough size={14} />
      </BBtn>

      <BDivider />

      {/* ── headings ─────────────────────────────────────────── */}
      <BBtn
        tooltip="Heading 1"
        active={s.isH1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <span className="font-sans text-[11px] font-bold leading-none">H1</span>
      </BBtn>
      <BBtn
        tooltip="Heading 2"
        active={s.isH2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <span className="font-sans text-[11px] font-bold leading-none">H2</span>
      </BBtn>
      <BBtn
        tooltip="Heading 3"
        active={s.isH3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <span className="font-sans text-[11px] font-bold leading-none">H3</span>
      </BBtn>

      <BDivider />

      {/* ── inline specials ───────────────────────────────────── */}
      <HighlightPicker editor={editor} active={s.isHighlight} />
      <BBtn
        tooltip="Inline code"
        active={s.isCode}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={14} />
      </BBtn>
      <BBtn
        tooltip="Blockquote"
        active={s.isBlockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quotes size={14} />
      </BBtn>
      <BBtn
        tooltip="Link"
        active={s.isLink}
        onClick={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run()
          } else {
            const url = window.prompt("URL")
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }
        }}
      >
        <Link size={14} />
      </BBtn>
    </BubbleMenu>
  )
}
