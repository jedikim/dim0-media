import { cn } from "@/lib/utils"
import { MdEditor } from "@/components/editor/tiptap"
import type { PageProvider } from "@/components/editor/tiptap/page/types"


type SheetEditorProps = {
  value: string
  onSave: (markdown: string) => void
  className?: string
  pageProvider?: PageProvider | null
  parentNoteId?: string | null
}


export const SheetEditor = ({ value, onSave, className, pageProvider, parentNoteId }: SheetEditorProps) => {
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
      />
    </div>
  )
}
