"""Postgres helpers for the durable collab op-log.

The op-log is the "post office" substrate for sync: every applied op batch is
appended as one `(board_id, seq, batch)` row. It replaces the volatile in-memory
ring buffer as the source of truth for reconnect catch-up, and it lets the
relay's `seq` survive a restart (re-seeded from `MAX(seq)`).
"""

from __future__ import annotations

import json

import asyncpg


async def create_board_oplog_table(conn: asyncpg.Connection) -> None:
    """Create the board op-log table + batch-id index when missing. Idempotent."""
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS board_oplog (
            board_id TEXT NOT NULL,
            seq BIGINT NOT NULL,
            batch JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (board_id, seq)
        )
        """
    )
    # Fast dedup lookup by (board_id, batch id) — a reconnecting client replays
    # its outbox, so the relay must recognize an already-applied batch.
    await conn.execute(
        """
        CREATE INDEX IF NOT EXISTS board_oplog_batch_id_idx
        ON board_oplog (board_id, (batch->>'id'))
        """
    )


async def insert_oplog_entry(
    conn: asyncpg.Connection,
    board_id: str,
    seq: int,
    batch: dict,
) -> bool:
    """Append one batch at `(board_id, seq)`. Idempotent.

    Returns True if a row was inserted, False if `(board_id, seq)` already
    existed (a replay) — the primary key makes appends safe to retry.
    """
    result = await conn.execute(
        """
        INSERT INTO board_oplog (board_id, seq, batch)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (board_id, seq) DO NOTHING
        """,
        board_id,
        seq,
        json.dumps(batch),
    )
    # asyncpg returns e.g. "INSERT 0 1" (inserted) or "INSERT 0 0" (conflict).
    return result.endswith(" 1")


async def fetch_batches_since(
    conn: asyncpg.Connection,
    board_id: str,
    since_seq: int,
    limit: int,
) -> list[tuple[int, dict]]:
    """Return `(seq, batch)` rows for `seq > since_seq`, ascending, up to `limit`."""
    rows = await conn.fetch(
        """
        SELECT seq, batch
        FROM board_oplog
        WHERE board_id = $1 AND seq > $2
        ORDER BY seq ASC
        LIMIT $3
        """,
        board_id,
        since_seq,
        limit,
    )
    return [(row["seq"], json.loads(row["batch"])) for row in rows]


async def fetch_max_seq(conn: asyncpg.Connection, board_id: str) -> int:
    """Return the highest seq stored for a board (0 when the log is empty)."""
    value = await conn.fetchval(
        "SELECT COALESCE(MAX(seq), 0) FROM board_oplog WHERE board_id = $1",
        board_id,
    )
    return int(value)


async def fetch_seq_for_batch(
    conn: asyncpg.Connection,
    board_id: str,
    batch_id: str,
) -> int | None:
    """Return the seq a batch was already applied at, or None if never seen."""
    return await conn.fetchval(
        "SELECT seq FROM board_oplog WHERE board_id = $1 AND batch->>'id' = $2 LIMIT 1",
        board_id,
        batch_id,
    )
