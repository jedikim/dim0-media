import type { Editor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import {
  RowsPlusTop,
  RowsPlusBottom,
  ColumnsPlusLeft,
  ColumnsPlusRight,
  TrashSimple,
  MinusCircle,
} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

type Props = { editor: Editor }


function TBtn({
  onClick,
  tooltip,
  danger,
  children,
}: {
  onClick: () => void
  tooltip: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={tooltip}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] transition-colors",
        danger
          ? "text-red-400 hover:bg-red-500/10 hover:text-red-500"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}


function TDivider() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
}


/** Floating toolbar that appears whenever the cursor is inside a table cell. */
export function TableMenu({ editor }: Props) {
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e }) =>
        e.isActive("tableCell") || e.isActive("tableHeader")
      }
      options={{ placement: "top-start", offset: 8 }}
      className="table-menu flex items-center gap-0.5 rounded-lg border border-border/70 bg-card px-1 py-0.5 shadow-md"
    >
      {/* ── rows ──────────────────────────────────────── */}
      <TBtn
        tooltip="Insert row above"
        onClick={() => editor.chain().focus().addRowBefore().run()}
      >
        <RowsPlusTop size={15} />
      </TBtn>
      <TBtn
        tooltip="Insert row below"
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        <RowsPlusBottom size={15} />
      </TBtn>
      <TBtn
        tooltip="Delete row"
        danger
        onClick={() => editor.chain().focus().deleteRow().run()}
      >
        <MinusCircle size={14} />
      </TBtn>

      <TDivider />

      {/* ── columns ───────────────────────────────────── */}
      <TBtn
        tooltip="Insert column left"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
      >
        <ColumnsPlusLeft size={15} />
      </TBtn>
      <TBtn
        tooltip="Insert column right"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        <ColumnsPlusRight size={15} />
      </TBtn>
      <TBtn
        tooltip="Delete column"
        danger
        onClick={() => editor.chain().focus().deleteColumn().run()}
      >
        <MinusCircle size={14} />
      </TBtn>

      <TDivider />

      {/* ── table ─────────────────────────────────────── */}
      <TBtn
        tooltip="Delete table"
        danger
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        <TrashSimple size={14} />
      </TBtn>
    </BubbleMenu>
  )
}
