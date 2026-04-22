import { useEffect, useRef, useState } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { useDebouncedCallback } from "use-debounce"
import { getExtensions } from "./extensions"
import { EditorBubbleMenu } from "./bubble-menu"
import { TableMenu } from "./table-menu"
import { BlockHandle } from "./block-handle"
import { StatusBar } from "./status-bar"
import { TocPanel } from "./toc"
import { TagPanel } from "./tag/tag-panel"
import { scanTags } from "./tag/tag-utils"
import type { TagGroup } from "./tag/tag-utils"
import "./editor.css"

export interface MdEditorProps {
  markdown: string
  onSave: (markdown: string) => void
  placeholder?: string
  className?: string
}

export function TipTapEditor({ markdown, onSave, placeholder, className }: MdEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  const [tags, setTags] = useState<TagGroup[]>(() => scanTags(markdown))

  const debouncedSave = useDebouncedCallback((md: string) => {
    onSaveRef.current(md)
    setTags(scanTags(md))
  }, 2000)

  const editor = useEditor({
    extensions: getExtensions(placeholder),
    content: markdown,
    immediatelyRender: false,
    onUpdate({ editor }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      debouncedSave((editor as any).storage.markdown.getMarkdown())
    },
  })

  // Ctrl+S / Cmd+S — flush debounce and save immediately
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        if (!editor) return
        debouncedSave.flush()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const md = (editor as any).storage.markdown.getMarkdown() as string
        onSaveRef.current(md)
        setTags(scanTags(md))
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [editor, debouncedSave])

  // Flush on unmount so no pending saves are lost
  useEffect(() => () => { debouncedSave.flush() }, [debouncedSave])

  if (!editor) return null

  return (
    <div className={`flex h-full flex-col overflow-hidden${className ? ` ${className}` : ""}`}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={scrollRef} className="tiptap-editor editor-body scrollbar-thin flex-1">
          <EditorBubbleMenu editor={editor} />
          <TableMenu editor={editor} />
          <BlockHandle editor={editor} />
          <TagPanel tags={tags} />
          <EditorContent editor={editor} />
        </div>
        <TocPanel editor={editor} scrollRef={scrollRef} />
      </div>

      <StatusBar editor={editor} />
    </div>
  )
}
