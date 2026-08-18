/**
 * Local board registry (A2) — board metadata + per-device view state.
 *
 * Stores `BoardMeta` (the local board index, incl. local-only boards) and
 * `BoardView` (camera/selection, per device) via the `StorageEngine` port. Board
 * *content* lives in the snapshot/oplog stores driven by `BoardPersistence`;
 * `deleteBoard` cascades those in one transaction — metadata, view, snapshot +
 * oplog, chats + messages, uploaded documents + chunks, and the sync cursor
 * (`sync_meta`). One known gap: per-widget `mini_app_state` (keyed by noteId, no
 * by-board index) is not yet cascaded — a storage leak tracked as a follow-up,
 * not data loss.
 *
 * Engine ownership: if no engine is injected the registry opens and owns one
 * (self-contained lifecycle via `init`/`close`); when the composition root
 * injects a shared engine, `close` leaves it open for the owner to release.
 */
import { v4 as uuidv4 } from "uuid"
import type { BoardMeta, BoardView } from "@/features/board/model"
import { IndexedDbEngine } from "./indexeddb-engine"
import type { Collection, StorageEngine } from "./engine"


export type BoardRegistryOptions = { engine?: StorageEngine; dbName?: string }


// Every store a board's data spans — the cascade-delete transaction covers all.
const BOARD_COLLECTIONS: Collection[] = [
  "boards", "views", "snapshots", "oplog", "chats", "chat_messages", "documents", "chunks", "sync_meta", "snapshot_meta",
]


/** Build a fresh local-only board's metadata. `now` is epoch ms (injectable). */
export const newLocalBoard = (title: string, now: number): BoardMeta => ({
  id: uuidv4(),
  title,
  kind: "local-only",
  visibility: "private",
  createdAt: now,
  updatedAt: now,
})


export class BoardRegistry {
  private engine: StorageEngine | null
  private readonly dbName?: string
  private readonly ownsEngine: boolean


  constructor(opts: BoardRegistryOptions = {}) {
    this.engine = opts.engine ?? null
    this.dbName = opts.dbName
    this.ownsEngine = !opts.engine
  }


  /** Open the database if this registry owns its engine. Idempotent. */
  async init(): Promise<void> {
    if (!this.engine) this.engine = await IndexedDbEngine.open(this.dbName)
  }


  /** Insert or replace a board's metadata. */
  async createBoard(meta: BoardMeta): Promise<void> {
    await this.requireEngine().put("boards", meta)
  }


  /** Fetch one board's metadata. */
  async getBoard(id: string): Promise<BoardMeta | undefined> {
    return this.requireEngine().get<BoardMeta>("boards", id)
  }


  /** List all non-deleted boards (the local board index). */
  async listBoards(): Promise<BoardMeta[]> {
    const all = await this.requireEngine().list<BoardMeta>("boards")
    return all.filter((b) => !b.deletedAt)
  }


  /** Rename a board (no-op if it doesn't exist). Used by describe_board auto-label. */
  async renameBoard(id: string, title: string, now: number = Date.now()): Promise<void> {
    const engine = this.requireEngine()
    const existing = await engine.get<BoardMeta>("boards", id)
    if (!existing) return
    await engine.put("boards", { ...existing, title, updatedAt: now })
  }


  /**
   * Set which collab client a synced board mounts (`legacy` | `v2`). No-op if
   * the board doesn't exist. Flipped when a board is promoted local → synced.
   */
  async setSyncEngine(
    id: string,
    syncEngine: "legacy" | "v2",
    now: number = Date.now(),
  ): Promise<void> {
    const engine = this.requireEngine()
    const existing = await engine.get<BoardMeta>("boards", id)
    if (!existing) return
    await engine.put("boards", { ...existing, syncEngine, updatedAt: now })
  }


  /**
   * Promote a local board to synced: set `kind=synced`, the collab engine, and
   * the owner. No-op if the board doesn't exist. Called after the adopt endpoint
   * accepts the board (local → synced). Keeps the id + content unchanged.
   */
  async markSynced(
    id: string,
    opts: { syncEngine: "legacy" | "v2"; ownerId: string },
    now: number = Date.now(),
  ): Promise<void> {
    const engine = this.requireEngine()
    const existing = await engine.get<BoardMeta>("boards", id)
    if (!existing) return
    await engine.put("boards", {
      ...existing,
      kind: "synced",
      syncEngine: opts.syncEngine,
      ownerId: opts.ownerId,
      updatedAt: now,
    })
  }


  /** Store a board's thumbnail (a data URL). No-op if the board doesn't exist. */
  async setThumbnail(id: string, thumbnail: string, now: number = Date.now()): Promise<void> {
    const engine = this.requireEngine()
    const existing = await engine.get<BoardMeta>("boards", id)
    if (!existing) return
    await engine.put("boards", { ...existing, thumbnail, updatedAt: now })
  }


  /** Delete a board and ALL its data (meta + view + content + chats + messages) atomically. */
  async deleteBoard(id: string): Promise<void> {
    await this.requireEngine().tx(BOARD_COLLECTIONS, async (t) => {
      await t.delete("boards", id)
      await t.delete("views", id)
      await t.delete("snapshots", id)
      await t.delete("oplog", { lower: [id, 0], upper: [id, Number.MAX_SAFE_INTEGER] })
      // Cascade the sync cursor. Leaving it behind is a silent data-loss trap: if
      // the same board id is later re-hydrated (a synced board deleted locally then
      // re-opened), a stale `syncedSeq` makes fresh low-seq edits look already-acked
      // (`outbox.pending()` skips seq <= cursor) → they're never sent to the relay.
      await t.delete("sync_meta", id)
      // Cascade the agent snapshot cursor for the same reason: a stale `seenSeq`
      // on a re-hydrated same-id board would omit fresh low-seq edits from the
      // snapshot's "recent changes" until the seq passes the stale value.
      await t.delete("snapshot_meta", id)
      // Cascade the board's chats and their message transcripts.
      const chats = await t.list<{ id: string }>("chats", { index: "by-board", range: { lower: id, upper: id } })
      for (const chat of chats) {
        await t.delete("chat_messages", { lower: [chat.id, ""], upper: [chat.id, "￿"] })
        await t.delete("chats", chat.id)
      }
      // Cascade the board's uploaded documents + their retrieval chunks.
      const docs = await t.list<{ id: string }>("documents", { index: "by-board", range: { lower: id, upper: id } })
      for (const doc of docs) await t.delete("documents", doc.id)
      const chunks = await t.list<{ chunkId: string }>("chunks", { index: "by-board", range: { lower: id, upper: id } })
      for (const chunk of chunks) await t.delete("chunks", chunk.chunkId)
    })
  }


  /** Persist per-device view state (camera/selection) for a board. */
  async saveView(id: string, view: BoardView): Promise<void> {
    await this.requireEngine().put("views", view, id)
  }


  /** Load per-device view state, or undefined if none saved. */
  async loadView(id: string): Promise<BoardView | undefined> {
    return this.requireEngine().get<BoardView>("views", id)
  }


  /** Release the engine if owned; a no-op for an injected (shared) engine. */
  close(): void {
    if (this.ownsEngine) this.engine?.close()
    this.engine = null
  }


  private requireEngine(): StorageEngine {
    if (!this.engine) throw new Error("BoardRegistry.init() must be called first")
    return this.engine
  }
}
