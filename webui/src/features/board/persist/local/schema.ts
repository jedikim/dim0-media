/**
 * Declarative store schema — the single source of truth for the local database
 * shape, consumed by both the IndexedDB opener (`idb.ts`) and the in-memory
 * engine. Keeping it here (rather than inline in the idb `upgrade`) lets a second
 * `StorageEngine` implementation build the same stores/indexes, and documents the
 * schema in one place.
 */
import type { Collection } from "./engine"


export type CollectionSchema = {
  /** Inline key path, or `null` for out-of-line (caller-supplied) keys. */
  keyPath: string | string[] | null
  /** Secondary indexes: index name → the value field it indexes. */
  indexes?: Record<string, string>
}


export const COLLECTIONS: Record<Collection, CollectionSchema> = {
  snapshots: { keyPath: null },
  oplog: { keyPath: ["boardId", "seq"] },
  boards: { keyPath: "id" },
  views: { keyPath: null },
  chats: { keyPath: "id", indexes: { "by-board": "boardId" } },
  chat_messages: { keyPath: ["chatUid", "id"] },
  mini_app_state: { keyPath: "noteId" },
  sync_meta: { keyPath: "boardId" },
  // Document Q&A (per-board): an uploaded doc's metadata + its retrieval chunks.
  documents: { keyPath: "id", indexes: { "by-board": "boardId" } },
  chunks: { keyPath: "chunkId", indexes: { "by-board": "boardId", "by-doc": "docId" } },
}
