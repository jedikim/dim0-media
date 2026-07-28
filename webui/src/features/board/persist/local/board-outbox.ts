/**
 * Board outbox (offline send-path) — the local batches the relay hasn't acked yet.
 *
 * There's no separate queue: the outbox IS the oplog tail beyond a persisted
 * `syncedSeq` cursor. On (re)connect the coordinator sends `pending()`; as the
 * relay acks (`op-applied`), it advances the cursor with `markSyncedTo`. The
 * cursor is durable so a reload doesn't re-send the whole log (and re-sends are
 * idempotent at the relay via `batch.id` anyway).
 */
import type { StorageEngine } from "./engine"
import type { OplogRecord, SyncMetaRecord } from "./idb"


export class BoardOutbox {
  private readonly engine: StorageEngine
  private readonly boardId: string


  constructor(engine: StorageEngine, boardId: string) {
    this.engine = engine
    this.boardId = boardId
  }


  /** Highest local oplog seq the relay has acked (0 = nothing synced yet). */
  async syncedSeq(): Promise<number> {
    const meta = await this.engine.get<SyncMetaRecord>("sync_meta", this.boardId)
    return meta?.syncedSeq ?? 0
  }


  /**
   * Local batches not yet acked, in seq order (each record carries its oplog seq).
   * Filters OUT `origin: 'remote'` only — the oplog also holds persisted remote
   * ops (recordRemote) which must never be sent back to the relay (echo). Both
   * `local` (edits) and `history` (undo/redo) must be sent, matching the legacy
   * client's `origin !== 'remote'` send rule. (Filtering to `=== 'local'` dropped
   * undo/redo: never synced, and stuck forever in the coordinator's rebase set.)
   */
  async pending(): Promise<OplogRecord[]> {
    const synced = await this.syncedSeq()
    const rows = await this.engine.list<OplogRecord>("oplog", {
      range: { lower: [this.boardId, synced], upper: [this.boardId, Number.MAX_SAFE_INTEGER], lowerOpen: true },
    })
    return rows.filter((r) => r.batch.origin !== "remote")
  }


  /** Advance the synced cursor (monotonic) once the relay has acked up to `localSeq`. */
  async markSyncedTo(localSeq: number): Promise<void> {
    if (localSeq <= (await this.syncedSeq())) return
    await this.engine.put<SyncMetaRecord>("sync_meta", { boardId: this.boardId, syncedSeq: localSeq })
  }
}
