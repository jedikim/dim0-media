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
 * Block-level subpage card. Shows a full-width "page inside a page" tile
 * (icon + live title) and navigates via the host's PageProvider on click.
 * Title is resolved live through the page cache; the markdown's snapshot
 * is only used as a fallback for offline / deleted pages.
 */
export function SubpageView({ node, editor }: NodeViewProps) {
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
      // Cache was invalidated externally (e.g. parent renamed the page);
      // trigger a fresh resolve so the chip updates without a reload.
      if (next === undefined) {
        void resolvePage(provider, pageId)
      }
    })
    void resolvePage(provider, pageId)
    return () => {
      unsubscribe()
    }
  }, [pageId, editor])

  const isDeleted = cached === null
  const liveTitle = cached?.title?.trim()
  const displayTitle = liveTitle || fallbackTitle

  function navigate() {
    if (isDeleted) return
    getProvider(editor)?.onNavigate?.(pageId)
  }

  return (
    <NodeViewWrapper
      as="div"
      className="subpage-card-wrap"
      contentEditable={false}
    >
      <PageHoverCard cached={cached} fallbackTitle={fallbackTitle}>
        <button
          type="button"
          onClick={navigate}
          disabled={isDeleted}
          className={isDeleted ? "subpage-card subpage-card--deleted" : "subpage-card"}
        >
          <Notepad size={16} weight="duotone" className="subpage-card-icon" />
          <span className="subpage-card-title">{displayTitle}</span>
          {isDeleted && <span className="subpage-card-suffix">(deleted)</span>}
        </button>
      </PageHoverCard>
    </NodeViewWrapper>
  )
}
