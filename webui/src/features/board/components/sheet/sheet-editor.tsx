import { cn } from "@/lib/utils"
import { MdEditor } from "@/components/editor/tiptap"
import type { PageProvider } from "@/components/editor/tiptap/page/types"


type SheetEditorProps = {
  value: string
  onSave: (markdown: string) => void
  className?: string
  pageProvider?: PageProvider | null
  parentNoteId?: string | null
  /** Optional content rendered above the prose, inside the editor's scroll. */
  bodyHeader?: React.ReactNode
}


export const SheetEditor = ({ value, onSave, className, pageProvider, parentNoteId, bodyHeader }: SheetEditorProps) => {
  return (
    <div
      className={cn("h-full w-full", className)}
      onDoubleClickCapture={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => e.stopPropagation()}
    >
      <MdEditor
        markdown={value}
        onSave={onSave}
        pageProvider={pageProvider}
        parentNoteId={parentNoteId}
        bodyHeader={bodyHeader}
      />
    </div>
  )
}
