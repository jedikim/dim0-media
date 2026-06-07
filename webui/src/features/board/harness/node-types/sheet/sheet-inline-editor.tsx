import { useEffect, useMemo, useRef } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import { useDebouncedCallback } from "use-debounce"
import { getExtensions } from "@/components/editor/tiptap/extensions"
import type { PageProvider } from "@/components/editor/tiptap/page/types"
import { sanitizeMathDelimiters } from "@/components/markdown/sanitize-math"
import { cn } from "@/lib/utils"
import "@/components/editor/tiptap/editor.css"
import "./sheet-inline-editor.css"


type SheetInlineEditorProps = {
  /** Canonical sheet body (markdown). */
  markdown: string
  /** When true, the card is an editable editor; when false, a read-only render. */
  editable: boolean
  /** Resolves @-mention / subpage chips (titles, icons, /subpage creation). */
  pageProvider?: PageProvider | null
  /** Sheet id, so /subpage nests new pages under it. */
  parentNoteId?: string
  /** Debounced + flush-on-exit persist of the edited markdown. */
  onSave: (markdown: string) => void
  /** Asked to leave edit mode (Escape, or focus left the editor). */
  onRequestExit?: () => void
  className?: string
}


/**
 * A single TipTap instance that renders the sheet body using the *same*
 * pipeline as the modal editor — so the canvas preview is pixel-identical to
 * edit mode (custom nodes, marks, code, math all render live). `editable`
 * flips it between a read-only preview and a live editor in place, with no
 * remount and no second renderer.
 */
export function SheetInlineEditor({
  markdown,
  editable,
  pageProvider,
  parentNoteId,
  onSave,
  onRequestExit,
  className,
}: SheetInlineEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null)

  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  // Markdown we last pushed in or saved out — lets the external-sync effect
  // skip our own echoes so a save round-trip doesn't reset the caret.
  const lastKnownMarkdown = useRef(markdown)

  const save = useDebouncedCallback((md: string) => {
    lastKnownMarkdown.current = md
    onSaveRef.current(md)
  }, 800)

  // `content` is read once on mount; further changes flow through the sync
  // effect below. Sanitize math delimiters to match the modal editor.
  const initialContent = useMemo(() => sanitizeMathDelimiters(markdown), [markdown])

  const editor = useEditor({
    extensions: getExtensions({ pageProvider, parentNoteId }),
    content: initialContent,
    editable,
    immediatelyRender: false,
    onUpdate({ editor }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      save((editor as any).storage.markdown.getMarkdown())
    },
  })

  // Flip read-only ↔ editable in place (no remount → seamless transition).
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  // Place the caret when entering edit mode.
  useEffect(() => {
    if (editor && editable) editor.commands.focus("end")
  }, [editor, editable])

  // External content sync: when the canonical markdown changes from elsewhere
  // (collab, AI), push it in — but skip our own saved echoes.
  useEffect(() => {
    if (!editor) return
    if (markdown === lastKnownMarkdown.current) return
    lastKnownMarkdown.current = markdown
    editor.commands.setContent(sanitizeMathDelimiters(markdown), { emitUpdate: false })
  }, [editor, markdown])

  // Don't lose a pending edit when the card unmounts (pan / zoom-out / LOD).
  useEffect(() => () => save.flush(), [save])

  if (!editor) return null

  return (
    <div
      ref={wrapRef}
      className={cn(
        "tiptap-editor sheet-inline-tiptap",
        !editable && "sheet-inline-tiptap--readonly",
        className,
      )}
      onKeyDown={(event) => {
        if (!editable) return
        if (event.key === "Escape") {
          event.stopPropagation()
          save.flush()
          onRequestExit?.()
        }
      }}
      onBlur={(event) => {
        if (!editable) return
        // Only exit when focus actually left the editor (not when it moved to
        // an inner node-view input / popover).
        if (wrapRef.current?.contains(event.relatedTarget as Node | null)) return
        save.flush()
        onRequestExit?.()
      }}
    >
      <EditorContent editor={editor} />
    </div>
  )
}
