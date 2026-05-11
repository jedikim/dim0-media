import { useState, useEffect, useRef } from "react"
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { CopySimple, Check, CaretDown } from "@phosphor-icons/react"
import { highlightCodeSync, ensureLanguage, LANGUAGE_OPTIONS } from "./shiki"
import { useTheme } from "@/components/theme-provider"


export function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const [copied, setCopied] = useState(false)
  const { shikiThemes } = useTheme()

  const code = node.textContent
  const lang = (node.attrs.language as string | null) ?? "plaintext"

  // Direct DOM refs — avoid React state updates so ProseMirror's cursor is never disturbed
  const shikiLayerRef = useRef<HTMLDivElement>(null)
  const editPreRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    // Try synchronous highlight first — keeps zero latency between keystroke
    // and visible token color, so the user never sees a "flash" between plain
    // text and highlighted text.
    const html = highlightCodeSync(code, lang, shikiThemes)
    if (html != null) {
      if (shikiLayerRef.current) shikiLayerRef.current.innerHTML = html
      editPreRef.current?.classList.add("shiki-loaded")
      return
    }
    // First-load path OR theme-switch where the new theme JSON isn't loaded
    // yet. If we already had Shiki output rendered, keep it visible during
    // the async load so the user doesn't flash to plain text — the old
    // colors are stale for a beat, then swap atomically.
    const hadShikiContent = !!shikiLayerRef.current?.innerHTML
    if (!hadShikiContent) {
      editPreRef.current?.classList.remove("shiki-loaded")
    }
    let cancelled = false
    ensureLanguage(lang, shikiThemes, () => {
      if (cancelled) return
      const ready = highlightCodeSync(code, lang, shikiThemes)
      if (ready != null && shikiLayerRef.current) {
        shikiLayerRef.current.innerHTML = ready
        editPreRef.current?.classList.add("shiki-loaded")
      }
    })
    return () => { cancelled = true }
  }, [code, lang, shikiThemes])

  function copyCode() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <NodeViewWrapper as="div" className="code-block-node">

      {/* ── header ──────────────────────────────────────────── */}
      <div className="code-block-header" contentEditable={false}>

        <div className="code-block-lang-wrap">
          <select
            value={lang}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateAttributes({ language: e.target.value })}
            className="code-block-lang-select"
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <CaretDown size={10} className="code-block-lang-caret" />
        </div>

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={copyCode}
          className="code-block-copy-btn"
          title={copied ? "Copied!" : "Copy code"}
        >
          {copied
            ? <Check size={13} weight="bold" className="text-green-500" />
            : <CopySimple size={13} />}
        </button>

      </div>

      {/* ── body: Shiki overlay + transparent editable layer ── */}
      <div className="code-block-body">

        {/* Shiki highlighted backdrop — mutated directly via ref, never via React state */}
        <div
          ref={shikiLayerRef}
          className="code-block-shiki-layer"
          aria-hidden="true"
        />

        {/* Editable ProseMirror content — transparent once Shiki is ready */}
        <pre ref={editPreRef} className="code-block-edit-pre">
          <NodeViewContent as={"code" as "div"} className="code-block-editable" />
        </pre>

      </div>
    </NodeViewWrapper>
  )
}
