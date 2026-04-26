import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Editor } from "@tiptap/react"


export type MathEditOpts = {
  pos: number
  latex: string
  isInline: boolean
}


let _openFn: ((opts: MathEditOpts) => void) | null = null


/** Trigger the floating math editor for the math node at `pos`. */
export function openMathEditor(opts: MathEditOpts): void {
  _openFn?.(opts)
}


export function MathEditPopover({ editor }: { editor: Editor }) {
  const [state, setState] = useState<MathEditOpts | null>(null)
  const [draft, setDraft] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    _openFn = (opts) => {
      setState(opts)
      setDraft(opts.latex)
    }
    return () => {
      _openFn = null
    }
  }, [])

  // Live update: dispatch each keystroke as `addToHistory: false` so the math
  // node re-renders in place without polluting the undo stack. The final
  // committing transaction in close() is the only history entry.
  useEffect(() => {
    if (!state) return
    const tr = editor.state.tr.setNodeMarkup(state.pos, null, {
      ...editor.state.doc.nodeAt(state.pos)?.attrs,
      latex: draft,
    })
    tr.setMeta("addToHistory", false)
    editor.view.dispatch(tr)
  }, [draft, state, editor])

  const close = useCallback(() => {
    if (!state) return
    // One history-bearing transaction representing the entire edit session.
    editor.chain()
      .focus()
      .setNodeSelection(state.pos)
      .updateAttributes(state.isInline ? "inlineMath" : "blockMath", { latex: draft })
      .run()
    setState(null)
  }, [editor, state, draft])

  // Esc → close (capture-phase to beat Radix Dialog's listener)
  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopImmediatePropagation()
      close()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [state, close])

  // Click outside → close + save
  useEffect(() => {
    if (!state) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && containerRef.current.contains(e.target as Node)) return
      close()
    }
    document.addEventListener("mousedown", onMouseDown, true)
    return () => document.removeEventListener("mousedown", onMouseDown, true)
  }, [state, close])

  if (!state) return null

  const editorDom = editor.view.dom as HTMLElement
  const host =
    editorDom.closest<HTMLElement>('[data-slot="dialog-content"]') ??
    editorDom.closest<HTMLElement>('[role="dialog"]') ??
    document.body

  const dom = editor.view.nodeDOM(state.pos) as HTMLElement | null
  if (!dom) return null
  const rect = dom.getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  const top = rect.bottom + 6 - hostRect.top
  const left = rect.left - hostRect.left

  return createPortal(
    <div
      ref={containerRef}
      className="math-edit-popover"
      style={{
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 9999,
        pointerEvents: "auto",
      }}
    >
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault()
            close()
          }
        }}
        rows={state.isInline ? 1 : 3}
        className="math-edit-textarea"
        placeholder={state.isInline ? "Inline LaTeX, e.g. x^2" : "LaTeX, e.g. \\frac{a}{b}"}
        spellCheck={false}
      />
    </div>,
    host,
  )
}
