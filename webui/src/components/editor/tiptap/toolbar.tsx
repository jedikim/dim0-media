import { useEditorState } from "@tiptap/react"
import type { Editor } from "@tiptap/react"
import { undoDepth, redoDepth } from "@tiptap/pm/history"
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  TextB,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  Link,
  CaretDown,
  Code,
  Quotes,
  NotePencilIcon,
  ListBullets,
  ListNumbers,
} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type Props = { editor: Editor }

function Divider() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
}

function TBtn({
  onClick,
  active,
  disabled,
  tooltip,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  tooltip: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          data-active={active}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-40",
            active && "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

const STYLES = [
  { label: "Paragraph", key: "paragraph", action: (e: Editor) => e.chain().focus().setParagraph().run() },
  { label: "Heading 1", key: "h1", action: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "Heading 2", key: "h2", action: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Heading 3", key: "h3", action: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: "Code block", key: "code", action: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
  { label: "Quote", key: "quote", action: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
] as const

function currentStyle(editor: Editor): string {
  if (editor.isActive("heading", { level: 1 })) return "Heading 1"
  if (editor.isActive("heading", { level: 2 })) return "Heading 2"
  if (editor.isActive("heading", { level: 3 })) return "Heading 3"
  if (editor.isActive("codeBlock")) return "Code block"
  if (editor.isActive("blockquote")) return "Quote"
  return "Paragraph"
}

export function Toolbar({ editor }: Props) {
  const s = useEditorState({
    editor,
    selector: (ctx) => ({
      canUndo: undoDepth(ctx.editor.state) > 0,
      canRedo: redoDepth(ctx.editor.state) > 0,
      isBold: ctx.editor.isActive("bold"),
      isItalic: ctx.editor.isActive("italic"),
      isUnderline: ctx.editor.isActive("underline"),
      isStrike: ctx.editor.isActive("strike"),
      isCode: ctx.editor.isActive("code"),
      isLink: ctx.editor.isActive("link"),
      isBulletList: ctx.editor.isActive("bulletList"),
      isOrderedList: ctx.editor.isActive("orderedList"),
      isHighlight: ctx.editor.isActive("highlight"),
      isBlockquote: ctx.editor.isActive("blockquote"),
      style: currentStyle(ctx.editor),
    }),
  })

  return (
    <div
      className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border bg-sidebar px-2"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* ── undo / redo ──────────────────────────────────────── */}
      <TBtn
        tooltip="Undo (Ctrl+Z)"
        disabled={!s.canUndo}
        onClick={() => editor.commands.undo()}
      >
        <ArrowCounterClockwise size={16} />
      </TBtn>
      <TBtn
        tooltip="Redo (Ctrl+Y)"
        disabled={!s.canRedo}
        onClick={() => editor.commands.redo()}
      >
        <ArrowClockwise size={16} />
      </TBtn>

      <Divider />

      {/* ── style dropdown ───────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span className="font-sans">{s.style}</span>
            <CaretDown size={12} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-36 font-sans text-sm">
          {STYLES.map((st) => (
            <DropdownMenuItem
              key={st.key}
              onSelect={() => st.action(editor)}
              className={cn(s.style === st.label && "bg-secondary text-secondary-foreground")}
            >
              {st.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      {/* ── marks ────────────────────────────────────────────── */}
      <TBtn
        tooltip="Bold (Ctrl+B)"
        active={s.isBold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <TextB size={16} weight="bold" />
      </TBtn>
      <TBtn
        tooltip="Italic (Ctrl+I)"
        active={s.isItalic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <TextItalic size={16} />
      </TBtn>
      <TBtn
        tooltip="Underline (Ctrl+U)"
        active={s.isUnderline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <TextUnderline size={16} />
      </TBtn>
      <TBtn
        tooltip="Strikethrough"
        active={s.isStrike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <TextStrikethrough size={16} />
      </TBtn>

      <Divider />

      {/* ── inline elements ───────────────────────────────────── */}
      <TBtn
        tooltip="Highlight"
        active={s.isHighlight}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <NotePencilIcon size={16} />
      </TBtn>
      <TBtn
        tooltip="Code (Ctrl+E)"
        active={s.isCode}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={16} />
      </TBtn>
      <TBtn
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
        <Link size={16} />
      </TBtn>

      <Divider />

      {/* ── lists ────────────────────────────────────────────── */}
      <TBtn
        tooltip="Bullet list"
        active={s.isBulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListBullets size={16} />
      </TBtn>
      <TBtn
        tooltip="Numbered list"
        active={s.isOrderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListNumbers size={16} />
      </TBtn>
      <TBtn
        tooltip="Blockquote"
        active={s.isBlockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quotes size={16} />
      </TBtn>
    </div>
  )
}
