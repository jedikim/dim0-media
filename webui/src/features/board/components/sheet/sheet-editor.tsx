import { cn } from "@/lib/utils"
import { MdEditor } from "@/components/editor/tiptap"

type SheetEditorProps = {
  value: string
  onSave: (markdown: string) => void
  className?: string
}

export const SheetEditor = ({ value, onSave, className }: SheetEditorProps) => {
  return (
    <div
      className={cn("h-full w-full", className)}
      onDoubleClickCapture={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => e.stopPropagation()}
    >
      <MdEditor markdown={value} onSave={onSave} />
    </div>
  )
}
