export interface Page {
  id: string
  title: string
  icon?: string
  parentId?: string
  /** Optional short body preview, used for hover (added in a later step). */
  snippet?: string
}


/**
 * Host-supplied CRUD adapter for pages. The editor knows nothing about
 * how pages are stored — it only calls these methods.
 */
export interface PageProvider {
  /** Search pages by title. Empty / undefined query returns recent pages. */
  list: (query?: string) => Promise<Page[]>
  /** Resolve a single page by id. Returns null if missing or no access. */
  get: (id: string) => Promise<Page | null>
  /** Create a new page; host returns the persisted record (with id). */
  create: (opts: { title: string; parentId?: string }) => Promise<Page>
  /** Optional: called when the user clicks a page reference chip. */
  onNavigate?: (id: string) => void
}
