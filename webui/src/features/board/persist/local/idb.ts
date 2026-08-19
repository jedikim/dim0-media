/**
 * IndexedDB schema + opener for local persistence.
 *
 * Stores:
 *   - `snapshots`     — materialized BoardContent per board (key = boardId).
 *   - `oplog`         — committed OpBatches since the last snapshot ([boardId, seq]).
 *   - `boards`        — BoardMeta (local board index), key = id.
 *   - `views`         — per-device BoardView (camera/selection), key = boardId.
 *   - `chats`         — chat metadata, key = id (chatUid). Mirrors backend Postgres.
 *   - `chat_messages` — agent transcript ([chatUid, id]). Mirrors backend Qdrant
 *                       (keyed store, no embeddings). Survives reloads.
 *
 * See offline-first-data-model.md.
 */
import { openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"
import type { OpBatch } from "@canvas-harness/core"
import type { LocalChat, LocalMessage } from "@/features/agent/types/chat"
import type { BoardContent, BoardMeta, BoardView } from "@/features/board/model"
import { COLLECTIONS } from "./schema"


export type SnapshotRecord = { content: BoardContent; seq: number }


/**
 * One committed batch in the local op-log.
 * - `seq`: local oplog seq (per board) — orders IndexedDB entries for replay.
 * - `serverSeq`: the relay-assigned order (undefined until acked). Materialize
 *   replays in `serverSeq` order so a reload converges the same way live sync
 *   does; unacked-local ops (no `serverSeq`) sort last (reconnect-order-wins).
 */
export type OplogRecord = { boardId: string; seq: number; batch: OpBatch; serverSeq?: number }


/** Sync cursor per board: the highest local oplog seq the relay has acked. */
export type SyncMetaRecord = { boardId: string; syncedSeq: number }


/**
 * Device-local snapshot cursor per board: the highest oplog seq this device has
 * already reflected in a board snapshot. Not synced — each device tracks how far
 * it has "seen" so the agent's snapshot can report changes since you last checked.
 */
export type SnapshotMetaRecord = { boardId: string; seenSeq: number }


/** An uploaded document's metadata (per board). Its markdown lives in its chunks. */
export type DocumentRecord = {
  id: string
  boardId: string
  title: string
  pages: number
  createdAt: number
}


/** One retrieval chunk of a document. `chunkId` is stable + prefix-matchable for
 *  citations; `index` is its position within the doc. */
export type ChunkRecord = {
  chunkId: string
  docId: string
  boardId: string
  index: number
  text: string
}


/** Scope of an agent memory: a fact about one board, or a per-user global fact. */
export type MemoryScope = "board" | "global"


/** Closed taxonomy (from CC/Hermes); `project` ≈ "what this board is about" at board scope. */
export type MemoryKind = "user" | "feedback" | "project" | "reference"


/**
 * A durable fact the agent saved. `bucket` collapses (scope, boardId) into one
 * indexable string (`board:<id>` | `global`) so both scopes list via one index.
 * `hash` (of the normalized body) drives deterministic dedup; `deleted` is a
 * soft-delete tombstone. `dirty`/`serverRev` are forward-compat for sync (Phase 7,
 * unused locally).
 */
export type MemoryRecord = {
  id: string
  scope: MemoryScope
  boardId: string | null
  bucket: string
  kind: MemoryKind
  title: string
  summary: string
  body: string
  hash: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
  dirty: boolean
  serverRev: number | null
}


interface Dim0DB extends DBSchema {
  snapshots: { key: string; value: SnapshotRecord }
  oplog: { key: [string, number]; value: OplogRecord }
  boards: { key: string; value: BoardMeta }
  views: { key: string; value: BoardView }
  chats: { key: string; value: LocalChat; indexes: { "by-board": string } }
  // `order` (on LocalMessage) records insertion order — message ids don't sort to
  // conversation order (assistant is minted before user; counter sorts lexically),
  // so reads must sort by that field, not by the key.
  chat_messages: { key: [string, string]; value: LocalMessage }
  // Per-note mini-app widget state (local analog of backend /mini-app-state).
  mini_app_state: { key: string; value: { noteId: string; state: unknown } }
  // Sync cursor per board (offline outbox — how far the relay has acked).
  sync_meta: { key: string; value: SyncMetaRecord }
  // Device-local snapshot cursor per board (how far the agent snapshot has "seen").
  snapshot_meta: { key: string; value: SnapshotMetaRecord }
  // Per-board uploaded documents + their retrieval chunks (document Q&A).
  documents: { key: string; value: DocumentRecord; indexes: { "by-board": string } }
  chunks: { key: string; value: ChunkRecord; indexes: { "by-board": string; "by-doc": string } }
  // Agent memory: board + global facts, listed per (scope, boardId) via `bucket`.
  memories: { key: string; value: MemoryRecord; indexes: { "by-bucket": string } }
}


export type Dim0Database = IDBPDatabase<Dim0DB>


const DB_NAME = "dim0"
const DB_VERSION = 8


// Minimal loose shapes for the upgrade loop (see the cast note in `upgrade`).
type UpgradeStore = {
  indexNames: DOMStringList
  createIndex: (name: string, keyPath: string | string[]) => unknown
}
type UpgradeDb = {
  objectStoreNames: DOMStringList
  createObjectStore: (name: string, options?: { keyPath?: string | string[] }) => UpgradeStore
}
type UpgradeTx = { objectStore: (name: string) => UpgradeStore }


/** Open (creating/upgrading) the dim0 database. `name` is overridable for tests. */
export const openDim0Db = (name: string = DB_NAME): Promise<Dim0Database> =>
  openDB<Dim0DB>(name, DB_VERSION, {
    // Idempotent: derives every store + index from the shared `COLLECTIONS`
    // descriptor and creates whatever's missing, so fresh installs and upgrades
    // converge on the same schema (the single source of truth in `schema.ts`).
    upgrade(db, _oldVersion, _newVersion, tx) {
      // Loose handles: the descriptor is keyed by a union of store names, which
      // collapses idb's per-store generics to `never`. `COLLECTIONS` is the typed
      // source of truth; here we just drive store/index creation from it.
      const rawDb = db as unknown as UpgradeDb
      const rawTx = tx as unknown as UpgradeTx
      for (const [name, spec] of Object.entries(COLLECTIONS)) {
        const store = rawDb.objectStoreNames.contains(name)
          ? rawTx.objectStore(name)
          : rawDb.createObjectStore(name, spec.keyPath !== null ? { keyPath: spec.keyPath } : undefined)
        for (const [indexName, field] of Object.entries(spec.indexes ?? {})) {
          if (!store.indexNames.contains(indexName)) store.createIndex(indexName, field)
        }
      }
    },
  })
