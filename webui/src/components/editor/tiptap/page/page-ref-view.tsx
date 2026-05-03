import { useEffect, useState } from "react"
import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { Notepad } from "@phosphor-icons/react"
import type { Page, PageProvider } from "./types"
import { readCachedPage, resolvePage, subscribePage } from "./page-cache"
import { PageHoverCard } from "./page-hover-card"


function getProvider(editor: NodeViewProps["editor"]): PageProvider | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = (editor.storage as any).pageProvider
  return storage?.provider ?? null
}


/**
 * Inline page-reference chip. Resolves the *live* page title through the
 * provider so renames propagate everywhere — the markdown's link text is
 * just a fallback used while resolution is in flight or when the page is
 * deleted / inaccessible.
 */
export function PageRefView({ node, editor }: NodeViewProps) {
  const pageId = (node.attrs.pageId as string) || ""
  const fallbackTitle = (node.attrs.title as string) || "Untitled"

  const [cached, setCached] = useState<Page | null | undefined>(() =>
    readCachedPage(pageId),
  )

  useEffect(() => {
    if (!pageId) return
    const provider = getProvider(editor)
    if (!provider) return

    setCached(readCachedPage(pageId))
    const unsubscribe = subscribePage(pageId, () => {
      const next = readCachedPage(pageId)
      setCached(next)
      // External invalidation (e.g. the page was renamed elsewhere) wipes
      // the entry; refetch so the chip's title stays in sync.
      if (next === undefined) {
        void resolvePage(provider, pageId)
      }
    })
    void resolvePage(provider, pageId)
    return () => {
      unsubscribe()
    }
  }, [pageId, editor])

  // cached === undefined → still resolving; show fallback.
  // cached === null      → backend says missing/forbidden; show "(deleted)".
  // cached === Page      → use its current title.
  const isDeleted = cached === null
  const liveTitle = cached?.title?.trim()
  const displayTitle = liveTitle || fallbackTitle

  function navigate() {
    if (isDeleted) return
    const provider = getProvider(editor)
    provider?.onNavigate?.(pageId)
  }

  return (
    <NodeViewWrapper as="span" className="page-ref-wrap">
      <PageHoverCard cached={cached} fallbackTitle={fallbackTitle}>
        <button
          type="button"
          className={isDeleted ? "page-ref page-ref--deleted" : "page-ref"}
          onClick={navigate}
          disabled={isDeleted}
        >
          <span className="page-ref-prefix" aria-hidden="true">@</span>
          <Notepad size={16} weight="duotone" className="page-ref-icon" />
          <span className="page-ref-title">{displayTitle}</span>
          {isDeleted && <span className="page-ref-suffix">(deleted)</span>}
        </button>
      </PageHoverCard>
    </NodeViewWrapper>
  )
}
