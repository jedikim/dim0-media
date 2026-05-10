import { useEffect, useMemo, useRef, useState } from "react"
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
import { MathEditPopover } from "./math/math-edit-popover"
import type { PageProvider } from "./page/types"
import { createStubPageProvider } from "./page/stub-page-provider"
import { sanitizeMathDelimiters } from "@/components/markdown/sanitize-math"
import "./editor.css"

export interface MdEditorProps {
  markdown: string
  onSave: (markdown: string) => void
  placeholder?: string
  className?: string
  /**
   * Host adapter for page CRUD (used by `@`-mention and the page-ref chip).
   * Falls back to an in-memory stub for development.
   */
  pageProvider?: PageProvider | null
  /** Id of the note this editor is editing — used by `/subpage` to nest. */
  parentNoteId?: string | null
  /**
   * Optional content rendered inside the editor's own scroll area, above
   * the prose. Use this for a page title (Notion-style) so it scrolls
   * with the article and we don't need a second outer scroll container.
   */
  bodyHeader?: React.ReactNode
}

export function TipTapEditor({
  markdown,
  onSave,
  placeholder,
  className,
  pageProvider,
  parentNoteId,
  bodyHeader,
}: MdEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  const [tags, setTags] = useState<TagGroup[]>(() => scanTags(markdown))

  // Tracks the markdown we last set on the editor (or that flowed back
  // through our own save). Lets the prop-sync effect skip work cheaply
  // without serializing the whole ProseMirror doc on every tick.
  const lastKnownMarkdownRef = useRef(markdown)

  const debouncedSave = useDebouncedCallback((md: string) => {
    lastKnownMarkdownRef.current = md
    onSaveRef.current(md)
    setTags(scanTags(md))
  }, 2000)

  const initialContent = useMemo(() => sanitizeMathDelimiters(markdown), [markdown])

  // Stable provider reference: host-supplied wins, otherwise an in-memory
  // stub created once per editor instance so the @-mention is functional
  // out of the box during development.
  const resolvedPageProvider = useMemo(
    () => pageProvider ?? createStubPageProvider(),
    [pageProvider],
  )

  const editor = useEditor({
    extensions: getExtensions({
      placeholder,
      pageProvider: resolvedPageProvider,
      parentNoteId,
    }),
    content: initialContent,
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

  // External content sync. `useEditor`'s `content` is only consumed on
  // mount, so when something outside (e.g. an AI rewrite) updates the
  // markdown prop we have to push it into the editor manually. Compare
  // against the markdown we last knew about so our own debounced saves
  // echoing back through the parent are no-ops — those would otherwise
  // force a setContent on every keystroke and trash the cursor.
  useEffect(() => {
    if (!editor) return
    if (markdown === lastKnownMarkdownRef.current) return
    lastKnownMarkdownRef.current = markdown
    editor.commands.setContent(sanitizeMathDelimiters(markdown), { emitUpdate: false })
    setTags(scanTags(markdown))
  }, [editor, markdown])

  // Flush on unmount so no pending saves are lost
  useEffect(() => () => { debouncedSave.flush() }, [debouncedSave])

  if (!editor) return null

  return (
    <div className={`flex h-full flex-col overflow-hidden${className ? ` ${className}` : ""}`}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div ref={scrollRef} className="tiptap-editor editor-body scrollbar-thin flex-1">
          <EditorBubbleMenu editor={editor} />
          <TableMenu editor={editor} />
          <BlockHandle editor={editor} />
          <MathEditPopover editor={editor} />
          {bodyHeader}
          <TagPanel tags={tags} />
          <EditorContent editor={editor} />
        </div>
        {/* Floating TOC: overlays the right gutter without taking layout
            space; subtle by default, full on hover; hidden below 900px so
            it never overlaps the centered ProseMirror text column. */}
        <div className="pointer-events-auto absolute right-2 top-4 z-10 opacity-30 transition-opacity duration-200 hover:opacity-100 max-[900px]:hidden">
          <TocPanel editor={editor} scrollRef={scrollRef} />
        </div>
      </div>

      <StatusBar editor={editor} />
    </div>
  )
}
