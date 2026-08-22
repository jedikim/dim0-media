"""Durable collab op-log + restart-safe sequence allocation.

Two concerns, one store:
  - the op-log itself (append / catch-up / max-seq), backed by Postgres;
  - `next_seq(board_id)` — a monotonic per-board sequence via Redis `INCR`,
    seeded from the durable log so a Redis wipe re-derives from Postgres
    instead of resetting to 0.

This is the server side of the offline-first client's `serverSeq` ordering:
the relay's `seq` must be stable across restarts or reload convergence breaks.
"""

from __future__ import annotations

import asyncpg

from topix.store.postgres.collab_oplog import (
    create_board_oplog_table,
    fetch_batches_since,
    fetch_max_seq,
    fetch_seq_for_batch,
    insert_oplog_entry,
)
from topix.store.redis.store import RedisStore

# Reconnect catch-up cap — a client drifted further than this rebuilds from a
# full snapshot instead (the oplog stays intact; we just bound one response).
DEFAULT_CATCHUP_LIMIT = 5_000

SEQ_KEY_PREFIX = "collab:seq:"


class CollabOplogStore:
    """Durable op-log storage plus restart-safe seq allocation."""

    def __init__(self, redis_store: RedisStore):
        """Init with the Redis store used for seq allocation."""
        self._pool: asyncpg.Pool | None = None
        self._redis = redis_store

    async def open(self, pool: asyncpg.Pool) -> None:
        """Attach the shared pool and ensure the op-log table exists."""
        self._pool = pool
        async with pool.acquire() as conn:
            await create_board_oplog_table(conn)

    async def close(self) -> None:
        """Detach the pool. The pool itself is owned/closed by the app."""
        self._pool = None

    async def append(
        self,
        board_id: str,
        seq: int,
        batch: dict,
        *,
        conn: asyncpg.Connection | None = None,
    ) -> bool:
        """Append a batch to the durable log. Idempotent (returns False on replay)."""
        if conn is not None:
            return await insert_oplog_entry(conn, board_id, seq, batch)
        async with self._require_pool().acquire() as acquired:
            return await insert_oplog_entry(acquired, board_id, seq, batch)

    async def batches_since(
        self,
        board_id: str,
        since_seq: int,
        *,
        limit: int = DEFAULT_CATCHUP_LIMIT,
    ) -> list[tuple[int, dict]]:
        """Ordered `(seq, batch)` catch-up slice for `seq > since_seq`."""
        async with self._require_pool().acquire() as conn:
            return await fetch_batches_since(conn, board_id, since_seq, limit)

    async def max_seq(
        self,
        board_id: str,
        *,
        conn: asyncpg.Connection | None = None,
    ) -> int:
        """Highest durable seq for a board (0 when empty)."""
        if conn is not None:
            return await fetch_max_seq(conn, board_id)
        async with self._require_pool().acquire() as acquired:
            return await fetch_max_seq(acquired, board_id)

    async def seq_for_batch(
        self,
        board_id: str,
        batch_id: str,
        *,
        conn: asyncpg.Connection | None = None,
    ) -> int | None:
        """Seq a batch was applied at, or None — used to dedup outbox replays."""
        if conn is not None:
            return await fetch_seq_for_batch(conn, board_id, batch_id)
        async with self._require_pool().acquire() as acquired:
            return await fetch_seq_for_batch(acquired, board_id, batch_id)

    async def next_seq(
        self,
        board_id: str,
        *,
        conn: asyncpg.Connection | None = None,
    ) -> int:
        """Allocate the next monotonic seq for a board (atomic, restart-safe).

        Uses Redis `INCR`. When the counter is absent (fresh process, or a Redis
        wipe/restart), it's first seeded from the durable log's `MAX(seq)` with a
        `SET NX` so a concurrent seeder can't clobber it — so seq never regresses
        even if Redis lost its state.
        """
        key = f"{SEQ_KEY_PREFIX}{board_id}"
        if not await self._redis.redis.exists(key):
            seed = (
                await self.max_seq(board_id)
                if conn is None
                else await self.max_seq(board_id, conn=conn)
            )
            await self._redis.redis.set(key, seed, nx=True)
        return int(await self._redis.redis.incr(key))

    def _require_pool(self) -> asyncpg.Pool:
        """Return the pool or raise if the store was never opened."""
        if self._pool is None:
            raise RuntimeError("CollabOplogStore.open() must be called first")
        return self._pool
