/**
 * Phase A — local-first data model (A0).
 *
 * The persisted/synced model IS the canvas-harness scene: geometry, content,
 * style, and groups are native `@canvas-harness/core` fields, so persistence is
 * identity (no convert layer). dim0's non-geometry domain fields ride in the
 * node/edge `data` slot (`DimNodeData` / `DimEdgeData`) — the one place the
 * library leaves open for app payload.
 *
 * Three board planes, by who-owns-and-what-syncs:
 *   - BoardContent — shared CRDT content (nodes/edges/groups). Synced.
 *   - BoardMeta    — title/kind/ACL. Server-authoritative (D1) + local index.
 *   - BoardView    — camera/selection. Per-device, never synced as content.
 *
 * See offline-first-data-model.md for the rationale.
 */
import type {
  CameraState,
  EdgeId,
  Group,
  NodeId,
  SchemaVersion,
  Edge as ChEdge,
  Node as ChNode,
} from "@canvas-harness/core"


/** App-level id. canvas-harness brands node/edge ids; this is the unbranded form. */
export type Id = string


/**
 * Per-entity sync + lifecycle envelope. Rides inside `data.meta`.
 * `updatedAt` is wall-clock for DISPLAY only — never used for merge ordering.
 * `hlc` (logical clock) is deferred to Lift 2; v1 leans on relay ordering.
 */
export type SyncMeta = {
  v: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
}


/**
 * Typed metadata value with a runtime-defined key. Only used in the optional
 * `props` bag (user-defined columns + agent outputs); omitted entirely in v1
 * unless those features ship. Values are always typed — only keys are dynamic.
 */
export type DataProperty =
  | { id: Id; type: "number"; number: number | null }
  | { id: Id; type: "date"; date: string | null }
  | { id: Id; type: "boolean"; boolean: boolean | null }
  | { id: Id; type: "text"; text: string | null }
  | { id: Id; type: "keyword"; value: string | number | null }
  | { id: Id; type: "url"; url: string | null }
  | { id: Id; type: "image"; image: { url: string; caption?: string } | null }
  | { id: Id; type: "file"; file: { url: string; name: string; size?: number } | null }
  | { id: Id; type: "location"; location: { lat: number; lng: number } | null }
  | { id: Id; type: "multi_text"; texts: string[] }
  | { id: Id; type: "multi_keyword"; values: (string | number)[] }
  // agent outputs — payloads kept loose for now (typed when the agent lands)
  | { id: Id; type: "reasoning"; reasoning: unknown[] }
  | { id: Id; type: "source"; sources: unknown[] }


/**
 * dim0 payload carried in a canvas-harness `node.data`. Geometry (x/y/w/h/z/
 * angle), body (`node.content`), style, and groups stay native on the node.
 * Type-specific fields (image/icon/code/frame) sit flat here too, since the
 * library reads e.g. `data.src` directly for built-in image/icon nodes.
 */
export type DimNodeData = {
  /** Title. The body lives in the native `node.content`. */
  label?: string
  /** Containment / subspace parent (recursive boards). */
  parentId?: Id | null
  pinned?: boolean
  listOrder?: number
  url?: string
  /** Optional dynamic metadata — user-defined columns + agent outputs. */
  props?: Record<string, DataProperty>
  meta: SyncMeta

  /**
   * Source-of-truth colors as picked (theme-independent). The display
   * `node.style.{bg,stroke,text}` is projected from these per theme mode;
   * keeping the canonical triplet here lets a theme flip re-project without
   * corrupting stored colors. Mirrors `NoteNodeData._storedColors`.
   */
  _storedColors?: { backgroundColor?: string; strokeColor?: string; textColor?: string }

  // type-specific (flat — read by the library for built-in types)
  src?: string //         image / icon source
  naturalW?: number //    image
  naturalH?: number //    image
  alt?: string //         image / icon
  language?: string //    code
  slideName?: string //   frame
  slideNumber?: number // frame
}


/** dim0 payload carried in a canvas-harness `edge.data`. */
export type DimEdgeData = {
  label?: string
  parentId?: Id | null
  props?: Record<string, DataProperty>
  meta: SyncMeta
}


/** A dim0 node — a canvas-harness node with a typed `data` payload. */
export type DimNode = ChNode & { data?: DimNodeData }


/** A dim0 edge — a canvas-harness edge with a typed `data` payload. */
export type DimEdge = ChEdge & { data?: DimEdgeData }


/**
 * Shared, synced board content — the CRDT document. Excludes camera/selection
 * (those are per-device view state, not shared). Persisted as snapshot + oplog.
 */
export type BoardContent = {
  schemaVersion: SchemaVersion
  nodes: DimNode[]
  edges: DimEdge[]
  groups: Group[]
  frameOrder?: NodeId[]
}


/** How a board is hosted. `local-only` = IndexedDB only, no account, no relay. */
export type BoardKind = "local-only" | "synced"


export type BoardRole = "owner" | "editor" | "viewer"


/**
 * Board metadata — server-authoritative (D1) for synced boards, plus a local
 * index entry for offline listing. NOT part of the synced CRDT content.
 */
export type BoardMeta = {
  id: Id
  title: string
  kind: BoardKind
  // Which collab client a `synced` board mounts. Absent ⇒ legacy `use-ws-collab`.
  // Set to `"v2"` on boards born from (or promoted into) the offline-first
  // coordinator. Ignored for `local-only` boards. Transient migration field:
  // removed once every synced board is v2 and the legacy client is retired.
  syncEngine?: "legacy" | "v2"
  ownerId?: Id
  acl?: Record<Id, BoardRole>
  visibility: "private" | "shared" | "public"
  thumbnail?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}


/** Per-device view state. Never synced as content; persisted locally per board. */
export type BoardView = {
  camera: CameraState
  selection: (NodeId | EdgeId)[]
}
