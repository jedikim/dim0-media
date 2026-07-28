"""Integration tests for the durable collab op-log + restart-safe seq.

The op-log table is exercised against the real test Postgres; the seq
allocator uses `fakeredis` (an in-memory Redis) so no Redis process is
needed — `RedisStore` takes an injected client, so the fake drops straight in.
"""

import uuid

import asyncpg
import pytest_asyncio

from fakeredis.aioredis import FakeRedis

from topix.config.config import Config
from topix.store.collab_oplog import CollabOplogStore
from topix.store.redis.store import RedisStore


@pytest_asyncio.fixture(loop_scope="function")
async def pool(config: Config):
    """Provide a real connection pool against the test Postgres."""
    created = await asyncpg.create_pool(config.run.databases.postgres.dsn())
    try:
        yield created
    finally:
        await created.close()


@pytest_asyncio.fixture(loop_scope="function")
async def store(pool):
    """Open a CollabOplogStore backed by fakeredis; clean its rows after."""
    redis = RedisStore(redis_client=FakeRedis(decode_responses=True))
    oplog = CollabOplogStore(redis)
    await oplog.open(pool)
    try:
        yield oplog
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM board_oplog WHERE board_id LIKE 'test-board-%'")
        await oplog.close()
        await redis.close()


def _board() -> str:
    """Return a unique board id so tests don't contaminate each other."""
    return f"test-board-{uuid.uuid4()}"


def _batch(i: int) -> dict:
    """Return a minimal op batch tagged with a stable id."""
    return {"id": f"b{i}", "clientId": "c", "ts": 0, "origin": "local", "ops": []}


async def test_append_and_read_back_in_order(store):
    """Appended batches read back in seq order with their payloads intact."""
    board = _board()
    for i in range(1, 4):
        assert await store.append(board, i, _batch(i)) is True
    entries = await store.batches_since(board, 0)
    assert [seq for seq, _ in entries] == [1, 2, 3]
    assert [b["id"] for _, b in entries] == ["b1", "b2", "b3"]
    assert await store.max_seq(board) == 3


async def test_append_is_idempotent(store):
    """Re-appending the same (board, seq) is a no-op (idempotent replay)."""
    board = _board()
    assert await store.append(board, 1, _batch(1)) is True
    assert await store.append(board, 1, _batch(1)) is False  # replay
    assert len(await store.batches_since(board, 0)) == 1


async def test_batches_since_slices_the_tail(store):
    """Catch-up returns exactly the entries after `since_seq`, in order."""
    board = _board()
    for i in range(1, 6):
        await store.append(board, i, _batch(i))
    entries = await store.batches_since(board, 3)
    assert [seq for seq, _ in entries] == [4, 5]


async def test_batches_since_respects_limit(store):
    """A drifted catch-up is bounded by `limit`."""
    board = _board()
    for i in range(1, 6):
        await store.append(board, i, _batch(i))
    entries = await store.batches_since(board, 0, limit=2)
    assert [seq for seq, _ in entries] == [1, 2]


async def test_max_seq_zero_when_empty(store):
    """An untouched board reports max seq 0."""
    assert await store.max_seq(_board()) == 0


async def test_seq_for_batch_finds_and_misses(store):
    """Dedup lookup returns the seq of a known batch id, None for an unknown one."""
    board = _board()
    await store.append(board, 1, _batch(1))
    await store.append(board, 2, _batch(2))
    assert await store.seq_for_batch(board, "b1") == 1
    assert await store.seq_for_batch(board, "b2") == 2
    assert await store.seq_for_batch(board, "nope") is None
    # Isolated per board.
    assert await store.seq_for_batch(_board(), "b1") is None


async def test_next_seq_is_monotonic(store):
    """Sequential allocations increase by one."""
    board = _board()
    assert [await store.next_seq(board) for _ in range(5)] == [1, 2, 3, 4, 5]


async def test_seq_isolated_per_board(store):
    """Each board has an independent counter."""
    a, b = _board(), _board()
    assert await store.next_seq(a) == 1
    assert await store.next_seq(a) == 2
    assert await store.next_seq(b) == 1


async def test_seq_survives_redis_wipe(store):
    """The money test: a Redis wipe re-seeds seq from Postgres, never resets to 1.

    Simulates a server restart / cache eviction between op batches — the
    durable log is the source of truth, so `serverSeq` ordering on the client
    stays monotonic across restarts.
    """
    board = _board()
    for _ in range(3):
        seq = await store.next_seq(board)
        await store.append(board, seq, _batch(seq))
    assert await store.max_seq(board) == 3

    await store._redis.redis.flushall()  # wipe the INCR counter

    assert await store.next_seq(board) == 4  # resumed from the durable log, not 1
