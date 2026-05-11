import { memo, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTheme } from "@/components/theme-provider"
import { buildWidgetDocument } from "./widget-document"


type WidgetIframeProps = {
  html: string
  className?: string
  title?: string
  autoHeight?: boolean
  maxHeight?: number
  minHeight?: number
}

/**
 * Render widget HTML in a sandboxed iframe using srcDoc.
 */
export const WidgetIframe = memo(function WidgetIframe({
  html,
  className,
  title = "Widget preview",
  autoHeight = false,
  maxHeight = 800,
  minHeight = 260,
}: WidgetIframeProps) {
  const { resolvedTheme } = useTheme()
  const frameId = useId()
  const [height, setHeight] = useState(minHeight)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Force the iframe to navigate to an empty document before React detaches
  // it. Setting srcdoc to a fresh value triggers the browser to unload the
  // previous document, terminating any setInterval / requestAnimationFrame /
  // listeners the widget HTML had scheduled. Without this, the previous
  // document can outlive the React unmount until garbage collection
  // (non-deterministic), and its scheduled work continues to consume CPU.
  useEffect(() => {
    // Cache the element at mount: `key={resolvedTheme}` already remounts
    // the whole component when the iframe DOM node changes, so the
    // captured `el` is guaranteed to match the iframe this instance owns
    // at cleanup time.
    const el = iframeRef.current
    return () => {
      if (!el) return
      el.srcdoc = "<!doctype html><html></html>"
    }
  }, [])

  useEffect(() => {
    if (!autoHeight || typeof window === "undefined") {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (
        !data ||
        typeof data !== "object" ||
        data.source !== "topix-widget-height" ||
        data.frameId !== frameId
      ) {
        return
      }

      const nextHeight = Number(data.height)
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
        return
      }

      setHeight(Math.max(minHeight, Math.min(maxHeight, Math.ceil(nextHeight))))
    }

    window.addEventListener("message", handleMessage)

    return () => {
      window.removeEventListener("message", handleMessage)
    }
  }, [autoHeight, frameId, maxHeight, minHeight])

  useEffect(() => {
    setHeight(minHeight)
  }, [html, minHeight, resolvedTheme])

  const srcDoc = useMemo(
    () => buildWidgetDocument(
      html,
      title,
      autoHeight ? { autoHeightFrameId: frameId } : undefined
    ),
    [autoHeight, frameId, html, title]
  )

  return (
    <iframe
      key={resolvedTheme}
      ref={iframeRef}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      style={autoHeight ? { height: `${height}px` } : undefined}
    />
  )
})
