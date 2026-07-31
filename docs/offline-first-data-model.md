# Offline-first data model (reference)

The on-device data model for local + v2-synced boards. Read-on-demand reference —
cited from `webui/src/features/board/model/index.ts` and `persist/local/idb.ts`.
For *why* the client owns sync see [`adr/ADR-SYNC-001`](./adr/ADR-SYNC-001-offline-first-relay.md);
for the store wiring overview see [`architecture.md`](./architecture.md). Verify
against code before relying on a detail.

## The three board planes

A board is split by *who owns it* and *what syncs* (`board/model/index.ts`):

| Plane | Holds | Syncs? | Authority |
|-------|-------|--------|-----------|
| `BoardContent` | nodes / edges / groups (the CRDT scene) | yes, via relay | shared |
| `BoardMeta` | title, `kind`, `syncEngine`, ACL | no (server + local index) | server |
| `BoardView` | camera, selection | no (per device) | local |

`BoardContent` excludes camera/selection on purpose — those are per-device
(`BoardView`) and must never enter the CRDT. `kind` is `local-only | synced`;
`syncEngine` is a transient migration field (`legacy | v2`, absent ⇒ legacy) that
disappears once every synced board is v2.

The offline-first plane is **identity-persisted**: the harness scene *is* the
model (geometry/content/style native; Dim0 fields ride in `node.data`/`edge.data`),
so there is no convert layer — unlike the backend/REST plane. Don't conflate them
([`architecture.md` §"Two persistence planes"](./architecture.md)).

## IndexedDB schema

DB `dim0`, **version 6**. `COLLECTIONS` in `persist/local/schema.ts` is the single
source of truth; `idb.ts` derives stores/indexes from it idempotently (a fresh
open and an upgrade converge on the same shape).

| Store | Key | Indexes | Holds |
|-------|-----|---------|-------|
| `snapshots` | `boardId` | — | compacted scene + its seq |
| `oplog` | `[boardId, seq]` | — | per-batch op log (the outbox source) |
| `boards` | `id` | — | `BoardMeta` |
| `views` | `boardId` | — | `BoardView` (camera/selection) |
| `sync_meta` | `boardId` | — | durable `syncedSeq` cursor |
| `chats` | `id` | by-board | chat sessions |
| `chat_messages` | `[chatUid, id]` | — | transcript rows |
| `documents` | `id` | by-board | ingested doc metadata |
| `chunks` | `chunkId` | by-board, by-doc | doc chunks (BM25 source) |
| `mini_app_state` | `noteId` | — | per-widget persisted state |

## Persistence invariants

- **Load = snapshot + replay.** `load()` reads the snapshot and replays oplog rows
  with `seq > snapshot.seq`, ordered by `serverSeq` (unacked-local sorts last).
  Correctness never depends on oplog truncation.
- **Snapshot+truncate is one transaction** (`writeSnapshot`) so the dangerous
  inverse (oplog deleted without a snapshot) can't happen on a crash.
- **The outbox is the oplog tail** past the durable `syncedSeq` cursor — not a
  separate queue. `pending()` returns `origin !== "remote"` rows above the cursor
  (`local` + `history`); `remote`/agent batches are stored via `recordRemote` and
  never re-sent. `markSyncedTo` is monotonic. See [`ADR-SYNC-001`](./adr/ADR-SYNC-001-offline-first-relay.md).
- **Batches are deduped by `batch.id`**; appends are serialized for monotonic seq;
  writes debounce ~50ms.

## Promotion (local → synced)

One-way, in-place, same board id (`board-registry.ts::markSynced` +
`POST /boards/{id}:adopt`). Safe against edits during the adopt round-trip via
`capture()` / `foldBase(content, seq)`: `capture` snapshots exactly what was
shipped to adopt; `foldBase` truncates the oplog only up to that seq, so any batch
appended during the round-trip (`seq' > seq`) stays pending for normal outbox
replay. If the promoted board is the one currently open, the view MUST navigate
`/local/$id → /boards/$id` so it re-mounts in collab mode (`promoteNavTarget`).

## Delete cascade — and the `sync_meta` trap

`deleteBoard` removes the board across its stores in one transaction. Cascading
`sync_meta` is **load-bearing**: a stale `syncedSeq` left behind would make a
re-created same-id board treat fresh low-seq edits as already-acked
(`pending()` skips `seq <= cursor`) → silent edit loss. Known gap: `mini_app_state`
(keyed by `noteId`, no by-board index) is not cascaded — a storage leak, not data
loss (roadmap).

## Dashboard partitioning

`selectOnDeviceBoards` (`screens/partition-boards.ts`) dedups the local list
against the backend `synced` list: drop any local board whose id is already in the
synced list (renders once under "Synced"; also covers the post-promotion window
before the local `kind` flip lands). Of the rest, `local-only` always shows; a
`synced` replica shows **only** for its signed-in owner (`ownerId === userId`) as
an offline/pre-refetch fallback — hidden when signed out or under another account,
so a board never leaks across sessions. Signed-out sentinel is `userId === "root"`;
gate on `isSignedIn()`, never `!!userId`.
