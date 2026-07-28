"""Unit tests for restart-safe collab seq allocation.

No Postgres and no Redis process: `fakeredis` stands in for Redis (injected
into `RedisStore`), and the durable `max_seq` read is stubbed. This isolates
the allocation logic — the SQL itself is covered by the integration tests.
"""

from fakeredis.aioredis import FakeRedis

from topix.store.collab_oplog import CollabOplogStore
from topix.store.redis.store import RedisStore


def _store(durable_max: int = 0) -> tuple[CollabOplogStore, RedisStore]:
    """Build a store on fakeredis with `max_seq` stubbed to `durable_max`."""
    redis = RedisStore(redis_client=FakeRedis(decode_responses=True))
    store = CollabOplogStore(redis)

    async def _max_seq(_board_id: str) -> int:
        return durable_max

    store.max_seq = _max_seq  # stand in for the durable Postgres read
    return store, redis


async def test_next_seq_is_monotonic():
    """Sequential allocations increase by one from an empty log."""
    store, _ = _store()
    assert [await store.next_seq("b1") for _ in range(5)] == [1, 2, 3, 4, 5]


async def test_next_seq_isolated_per_board():
    """Each board has an independent counter."""
    store, _ = _store()
    assert await store.next_seq("a") == 1
    assert await store.next_seq("a") == 2
    assert await store.next_seq("b") == 1


async def test_seq_seeds_from_durable_max_on_cold_start():
    """A fresh Redis counter resumes from the durable log's max, not from 1."""
    store, _ = _store(durable_max=42)
    assert await store.next_seq("b1") == 43


async def test_seq_survives_redis_wipe():
    """The money test: a Redis wipe re-seeds from the durable log, never resets.

    Allocate three seqs, then wipe Redis (server restart / cache eviction) with
    the durable log now holding max=3 — the next allocation must resume at 4.
    """
    store, redis = _store(durable_max=0)
    assert [await store.next_seq("b1") for _ in range(3)] == [1, 2, 3]

    async def _max3(_board_id: str) -> int:
        return 3

    store.max_seq = _max3  # the durable log grew alongside the allocations
    await redis.redis.flushall()  # wipe the INCR counter

    assert await store.next_seq("b1") == 4
