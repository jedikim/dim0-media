/**
 * Represents a URL annotation.
 */
export interface UrlAnnotation {
  type: "url"
  url: string
  title?: string
  content?: string
  favicon?: string
  coverImage?: string
  sourceDomain?: string
  publishedAt?: string // ISO 8601 date string
  tags?: string[]
}

export interface FileAnnotation {
  type: "file"
  fileType: string
  filePath: string
  fileId: string
}

export interface RefAnnotation {
  type: "reference"
  refId: string
}

export type Annotation = UrlAnnotation | FileAnnotation | RefAnnotation

export interface WebSearchOutput {
  type: "web_search"
  answer: string
  searchResults: UrlAnnotation[]
}

export interface MemorySearchOutput {
  type: "memory_search"
  answer: string
  references: RefAnnotation[]
}


/** One retrieved document passage (a `doc_search` hit) — its text plus the
 *  document it belongs to. `docId` is the unique key; `docTitle` is the label. */
export interface DocRef {
  chunkId: string
  docId: string
  docTitle: string
  text: string
}


/** The `doc_search` tool output: the passages retrieved from board documents. */
export interface DocSearchOutput {
  type: "doc_search"
  references: DocRef[]
}

export interface CodeInterpreterOutput {
  type: "code_interpreter"
  status: "success" | "error" | "timeout"
  stdout: string
  stderr: string
  durationMs: number
}

export interface CreateNoteOutput {
  type: "create_note"
  noteId: string
  graphUid: string
  label: string | null
  noteType: string
  parentId?: string | null
}

export interface WriteNoteOutput {
  type: "write_note"
  action: "created" | "rewritten"
  noteId: string
  graphUid: string
  label: string | null
  noteType: string
  parentId?: string | null
}

export interface EditNoteOutput {
  type: "edit_note"
  noteId: string
  graphUid: string
  label: string | null
  noteType: string
  parentId?: string | null
}


export interface GetNoteOutput {
  type: "get_note"
  noteId: string
  graphUid: string
  label: string | null
  content: string
  noteType: string
  parentId?: string | null
}


export interface LinkNotesOutput {
  type: "link_notes"
  linkId: string
  sourceId: string
  targetId: string
  graphUid: string
  label: string | null
}

export interface WeatherWidgetOutput {
  type: "display_weather_widget"
  city: string
}

export interface StockWidgetOutput {
  type: "display_stock_widget"
  symbol: string
}

export interface ImageSearchWidgetOutput {
  type: "display_image_search_widget"
  query: string
  images: string[]
}

export interface ImageGenerationOutput {
  type: "image_generation"
  imageUrls: string[]
}

export type ToolOutput =
  | WebSearchOutput
  | MemorySearchOutput
  | DocSearchOutput
  | CodeInterpreterOutput
  | WriteNoteOutput
  | CreateNoteOutput
  | EditNoteOutput
  | GetNoteOutput
  | LinkNotesOutput
  | WeatherWidgetOutput
  | StockWidgetOutput
  | ImageSearchWidgetOutput
  | ImageGenerationOutput
  | string
