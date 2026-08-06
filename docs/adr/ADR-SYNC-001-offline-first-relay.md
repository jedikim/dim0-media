# ADR-SYNC-001: Offline-first sync — the client owns conflict resolution; the backend is a sequencer + relay

**Status:** Accepted · 2026-07-31
**Applies to:** `webui/src/features/board/harness/sync/**`, `webui/src/features/board/persist/local/**`, `backend/topix/collab/**`, `backend/topix/api/router/collab.py`, `backend/topix/store/collab_oplog.py`

## Decision
v2 synced boards MUST resolve all conflicts **on the client** via rebase-LWW
(`board-sync.ts::applyRemote`): undo unacked local batches → apply the remote
batch onto the confirmed base → replay local forward → prune dangling edges. The
backend MUST NOT resolve conflicts — it only allocates a monotonic seq, persists
`node.*`/`edge.*` ops, and relays `peer-op`.

- Seq authority MUST be the **oplog** (`collab_oplog.py`: Redis `INCR` seeded via
  `SET NX` from PG `MAX(seq)`), never `room.seq` (a warm read cache).
- The client outbox **is** the IndexedDB oplog tail past a durable `syncedSeq`
  cursor — not a separate queue. Only `origin !== "remote"` batches are sent
  (`local` edits + `history` undo/redo); `remote`/agent batches are stored via
  `recordRemote` and MUST NOT be re-sent (echo guard).
- Re-sends MUST be idempotent at the relay, deduped by `batch.id`: a hit re-acks
  at the original seq and never re-applies, re-appends, or re-broadcasts.
- `local → synced` promotion is **one-way and in-place** (same board id) via
  `POST /boards/{id}:adopt` (owner-guarded, cap-gated at promotion). No demotion.

## Why
This is the load-bearing decision of the offline-first refactor (PR #154): by
putting the entire merge engine in the browser, the backend degrades to a
**stateless sequencer + relay**. That is what makes the app work fully offline
(IndexedDB durability, optimistic apply, reconnect-and-replay) and is the
precondition for a **bundled/local backend** — a desktop build can swap the relay
for a local process without reimplementing conflict resolution. Seq must live in
the oplog, not `room.seq`, so it never regresses across a restart or Redis wipe
(a regressed seq means reused seqs → clients diverge). LWW + a single server seq
ordering is sufficient for a single-authority relay, so richer causality was
deferred, not adopted.

## Consequences
- The backend still owns: ticket auth, capacity cap + `kick`, presence, snapshot
  serving, and durable persistence via `apply_ops.py`. `group.*`/`frame.reorder`
  are relayed but **not persisted**; wire colors are ignored (canonical from
  `data._storedColors` — see `docs/adr/ADR-AGENT-002` neighbours / architecture).
- `serverSeq` is stamped at ack so a reload replays in relay order and converges
  to the same state as the live session.
- A v2 board's base is materialized locally on first open — the **whole** board
  (all layers) via `GET /boards/:id?whole=true`, seeded with `writeInitialBase` on
  a pristine replica — so it loads offline at every layer; reconnect-drift base-
  replace is deferred (needs serverSeq-based truncation — roadmap). Model + guard →
  [`offline-first-data-model.md`](../offline-first-data-model.md).
- Single-worker `RoomRegistry` v1 (in-process dict, `room.lock` serializes a
  room). Multi-worker (Redis room-pinning + per-peer queues) is deferred — roadmap.
- Deleting a board MUST cascade `sync_meta`: a stale `syncedSeq` left behind makes
  a re-created same-id board treat fresh low-seq edits as already-acked → silent
  edit loss. See [`offline-first-data-model.md`](../offline-first-data-model.md).
- Known idempotency hazard: a coalesced message takes its **last** record's id, so
  a re-send whose membership changed re-applies an already-applied prefix — benign
  only because Qdrant apply is an idempotent upsert. Roadmap has the seq-range fix.

## Rejected alternatives
- **Server-side CRDT/OT** — couples merge logic to the server, blocks the
  local-backend goal, and is far heavier than the single-authority relay needs.
- **Authoritative `room.seq`** — a warm in-memory counter regresses on restart /
  Redis loss, reusing seqs and diverging clients; the durable oplog is the source.
- **HLC / vector clocks now** — LWW + server-seq ordering already converges for a
  single relay; causal metadata is deferred (roadmap) rather than paid for upfront.

## Verify
`grep -rn "applyRemote\|rollbackPending\|inverseBatch" webui/src/features/board/harness/sync/board-sync.ts` — conflict resolution lives only on the client.
`grep -rn "next_seq\|INCR\|MAX(seq)\|SET NX\|setnx" backend/topix/store/collab_oplog.py` — seq authority is the oplog, seeded from PG, not `room.seq`.
