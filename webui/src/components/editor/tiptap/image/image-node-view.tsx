import { useEffect, useState } from "react"
import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { resolveImageSrc, isDirectImageSrc } from "./image-cache"


/**
 * Image NodeView: renders an `<img>` whose `src` may be either a directly
 * usable URL (data:, http://, https://, blob:) or a server-side filePath
 * that has to be resolved to a base64 data URL via GET /files.
 *
 * Persisting the short filePath in the doc keeps markdown small enough to
 * survive backend embedding limits; this component handles the round trip.
 */
export function ImageNodeView({ node }: NodeViewProps) {
  const src = (node.attrs.src as string | undefined) ?? ""
  const alt = (node.attrs.alt as string | undefined) ?? ""

  const [resolved, setResolved] = useState<string | null>(
    isDirectImageSrc(src) ? src : null,
  )
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!src) return
    if (isDirectImageSrc(src)) {
      setResolved(src)
      setError(false)
      return
    }

    let cancelled = false
    setResolved(null)
    setError(false)
    resolveImageSrc(src)
      .then((url) => {
        if (!cancelled) setResolved(url)
      })
      .catch((err) => {
        console.error("[ImageNodeView] resolve failed", src, err)
        if (!cancelled) setError(true)
      })
    return () => { cancelled = true }
  }, [src])

  return (
    <NodeViewWrapper as="span" className="editor-image-wrap">
      {resolved ? (
        <img src={resolved} alt={alt} className="editor-image" draggable={false} />
      ) : error ? (
        <span className="editor-image-fallback">Failed to load image</span>
      ) : (
        <span className="editor-image-fallback">Loading image…</span>
      )}
    </NodeViewWrapper>
  )
}
