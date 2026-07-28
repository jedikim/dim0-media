import { useNavigate } from "@tanstack/react-router"
import { DocumentFileIcon, MapPinIcon } from "@/components/icons"
import { docAnchorId, type DocSource } from "../../utils/doc-sources"


/**
 * Document Sources for an answer (F2 B7) — the documents `doc_search` actually
 * retrieved from this turn, keyed by the unique `docId`. Each entry expands to
 * the passages that grounded the answer. Rendered inline (native `<details>`)
 * with a per-message `id` anchor (see `docAnchorId`), so a linkified title in
 * the answer scrolls to THIS message's source (not an older one's).
 */
export const DocSourcesView = ({ sources, messageId }: { sources: DocSource[]; messageId: string }) => {
  const navigate = useNavigate()
  if (sources.length === 0) return null

  // The doc node's id IS the docId, so ?center=<docId> jumps to it (useCenterFromUrl).
  const locate = (docId: string): void => {
    void navigate({ to: ".", replace: true, search: (prev: Record<string, unknown>) => ({ ...prev, center: docId }) })
  }

  return (
    <div className="mt-2 min-w-0 space-y-1">
      <div className="ml-1 flex items-center gap-1 text-xs font-mono text-muted-foreground">
        <DocumentFileIcon className="size-4 shrink-0 text-primary" strokeWidth={2} />
        <span className="text-primary">Documents</span>
      </div>
      {sources.map((s) => (
        <details
          key={s.docId}
          id={docAnchorId(messageId, s.docId)}
          className="scroll-mt-16 rounded-lg border border-border/60 bg-transparent"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-xs">
            <DocumentFileIcon className="size-3.5 shrink-0 text-primary" strokeWidth={2} />
            <span className="truncate text-primary">{s.docTitle || "Document"}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              {s.passages.length} passage{s.passages.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              aria-label="Find on board"
              title="Find on board"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-secondary-foreground"
              onClick={(e) => {
                e.preventDefault() // don't toggle the <details>
                e.stopPropagation()
                locate(s.docId)
              }}
            >
              <MapPinIcon className="size-3.5" strokeWidth={2} />
            </button>
          </summary>
          {s.passages.length > 0 && (
            <div className="space-y-2 px-3 pb-2 pt-1">
              {s.passages.map((p, i) => (
                <p key={i} className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {p}
                </p>
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  )
}
