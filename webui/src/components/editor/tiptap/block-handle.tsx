import { useState, useCallback, useMemo } from "react"
import { DragHandle } from "@tiptap/extension-drag-handle-react"
import { offset } from "@floating-ui/dom"
import type { Editor } from "@tiptap/react"
import type { Node } from "@tiptap/pm/model"
import { DotsSixVertical, Plus, Trash, CopySimple } from "@phosphor-icons/react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"


type CurrentNode = { node: Node; pos: number }


function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors",
        danger
          ? "text-red-400 hover:bg-red-500/10 hover:text-red-500"
          : "text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  )
}


/** Notion-style drag + block-action handle rendered next to the hovered block. */
export function BlockHandle({ editor }: { editor: Editor }) {
  const [currentNode, setCurrentNode] = useState<CurrentNode | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleNodeChange = useCallback(
    (data: { node: Node | null; editor: Editor; pos: number }) => {
      if (data.node) setCurrentNode({ node: data.node, pos: data.pos })
    },
    [],
  )

  // Stable object refs — `DragHandle` re-registers its PM plugin whenever these
  // change, and every register/unregister dispatches a transaction that makes
  // the slash-command Suggestion plugin exit.
  const computePositionConfig = useMemo(
    () => ({ middleware: [offset({ crossAxis: 4 })] }),
    [],
  )

  function addBlockBelow() {
    if (!currentNode) return
    const endPos = currentNode.pos + currentNode.node.nodeSize
    editor
      .chain()
      .focus()
      .insertContentAt(endPos, { type: "paragraph" })
      .setTextSelection(endPos + 1)
      .run()
  }

  function duplicateBlock() {
    if (!currentNode) return
    const { pos, node } = currentNode
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, node.toJSON())
      .run()
    setMenuOpen(false)
  }

  function deleteBlock() {
    if (!currentNode) return
    const { pos, node } = currentNode
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
    setMenuOpen(false)
  }

  return (
    <DragHandle
      editor={editor}
      onNodeChange={handleNodeChange}
      computePositionConfig={computePositionConfig}
    >
      <div className="block-handle-wrap">

        {/* + : add new paragraph below this block */}
        <button
          type="button"
          title="Add block below"
          className="block-handle-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addBlockBelow}
        >
          <Plus size={13} />
        </button>

        {/* grip: drag to reorder; click to open action menu */}
        <Popover open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <PopoverAnchor asChild>
            <button
              type="button"
              title="Drag or click for options"
              className="block-handle-btn block-drag-btn"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <DotsSixVertical size={14} />
            </button>
          </PopoverAnchor>

          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={6}
            className="w-40 p-1"
          >
            <MenuItem onClick={duplicateBlock}>
              <CopySimple size={14} />
              Duplicate
            </MenuItem>
            <div className="my-1 h-px bg-border" />
            <MenuItem danger onClick={deleteBlock}>
              <Trash size={14} />
              Delete
            </MenuItem>
          </PopoverContent>
        </Popover>

      </div>
    </DragHandle>
  )
}
