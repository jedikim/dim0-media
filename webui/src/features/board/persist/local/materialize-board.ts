import { getLocalStores } from "@/features/local-stores"
import { getWholeBoard } from "@/features/board/api/get-board"
import { graphToContent } from "@/features/board/harness/persist/snapshot-load"
import { BoardPersistence } from "./board-persistence"
import type { StorageEngine } from "./engine"
import type { OplogRecord, SnapshotRecord } from "./idb"


/**
 * Make a synced board available offline: fetch its WHOLE graph (all layers) and
 * write it as the local base.
 *
 * Used both on first open (auto, from the sync coordinator — which passes its own
 * mounted `persistence` so there's a single writer) and by the on-demand
 * "download for offline" action (headless — creates a transient instance).
 *
 * Seeds when the replica is **fully synced and quiet across the fetch**: no
 * snapshot yet, no UNSENT local edit, and the oplog doesn't change while the
 * whole-board fetch is in flight. Every oplog entry is then an acked-local or
 * remote op — already on the server, so already in the fetch — and the fetch is
 * the complete truth: we write it as the base and fold the whole (redundant)
 * oplog away, so nothing replays. This fixes "an edited synced board can never go
 * offline" (a non-empty all-acked oplog no longer blocks it). It DEFERS (returns
 * false) when there's an unsent local edit, or when a relay op is sequenced
 * during the fetch — folding by local seq could then drop or double-apply an op
 * we can't place relative to the fetched base; a later open/download retries.
 * (Folding without that defer needs the serverSeq model — roadmap Phase 2.)
 * Requires network; a rejection means "couldn't materialize" — best-effort.
 *
 * Concurrent calls for the same board (e.g. the coordinator's auto-seed on open
 * racing an on-demand "download" click) share one in-flight run, so the whole
 * board is fetched at most once. Returns whether a base was actually written.
 */
export function materializeBoardOffline(
  boardId: string,
  opts: { engine?: StorageEngine; persistence?: BoardPersistence } = {},
): Promise<boolean> {
  const running = inFlight.get(boardId)
  if (running) return running
  const run = doMaterialize(boardId, opts).finally(() => inFlight.delete(boardId))
  inFlight.set(boardId, run)
  return run
}


/** De-dupes concurrent materialize runs per board (see `materializeBoardOffline`). */
const inFlight = new Map<string, Promise<boolean>>()


const OPLOG_RANGE = (boardId: string) => ({
  range: { lower: [boardId, 0], upper: [boardId, Number.MAX_SAFE_INTEGER] },
})


/** Highest seq in an oplog page (0 when empty); the page is ordered by seq. */
const maxSeq = (oplog: OplogRecord[]): number => (oplog.length > 0 ? oplog[oplog.length - 1].seq : 0)


/** A local edit the relay hasn't acked yet — not on the server, so not in the fetch. */
const hasUnsentLocal = (oplog: OplogRecord[]): boolean =>
  oplog.some((e) => e.batch.origin !== "remote" && e.serverSeq === undefined)


async function doMaterialize(
  boardId: string,
  opts: { engine?: StorageEngine; persistence?: BoardPersistence },
): Promise<boolean> {
  const engine = opts.engine ?? (await getLocalStores()).engine

  // Already have a base → nothing to do.
  if (await engine.get<SnapshotRecord>("snapshots", boardId)) return false
  // Flush the mounted writer first so ops buffered in its debounce window are in
  // IDB and visible to the reads below (the growth check + unsent-local scan both
  // read the engine directly). No-op for a headless download (no persistence).
  await opts.persistence?.flush()
  // Bail before the fetch if a local edit is still unsent: it isn't on the
  // server (so not in the fetch), and folding the oplog away would drop it.
  const before = await engine.list<OplogRecord>("oplog", OPLOG_RANGE(boardId))
  if (hasUnsentLocal(before)) return false

  const graph = await getWholeBoard(boardId)

  // Flush again + re-read after the fetch: if the oplog GREW during the (seconds-
  // long) fetch window, a relay op was sequenced that may already be in the
  // fetched base — and we can't tell which by local seq, so folding could double-
  // apply it (the hazard the serverSeq model exists to solve). Defer instead; a
  // later open/download retries once the board is quiet. `setServerSeq` acks
  // don't change the max seq, so they don't block. Also re-check unsent-local.
  await opts.persistence?.flush()
  const after = await engine.list<OplogRecord>("oplog", OPLOG_RANGE(boardId))
  if (maxSeq(after) !== maxSeq(before) || hasUnsentLocal(after)) return false

  // Stable + all-acked/remote → every entry is on the server, i.e. in the fetch.
  // Write the fetch as the base and truncate the WHOLE oplog: nothing replays, so
  // no double-apply, and nothing is lost (it's all in the base). Empty oplog →
  // seq 0, truncates nothing (the pristine case). A brand-new unsent-local edit
  // in the sub-ms gap before the write lands at a higher seq → survives + replays.
  const persistence = opts.persistence ?? new BoardPersistence(boardId, { engine })
  await persistence.foldBase(graphToContent(graph), maxSeq(after))
  return true
}
