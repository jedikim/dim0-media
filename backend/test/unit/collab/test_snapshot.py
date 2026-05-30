"""Unit tests for the welcome snapshot reader + Room.seq."""

import asyncio

from typing import Any

from topix.collab.room import Room
from topix.collab.snapshot import build_welcome_snapshot


class _StaticGraphStore:
    """Returns a fixed graph object or raises if `raise_on_read=True`."""

    def __init__(self, *, graph: Any = None, raise_on_read: bool = False):
        """Init."""
        self._graph = graph
        self._raise = raise_on_read
        self.calls: list[dict] = []

    async def get_graph(self, *, graph_uid: str, root_id: str | None = None):
        """Get graph."""
        self.calls.append({"graph_uid": graph_uid, "root_id": root_id})
        if self._raise:
            raise RuntimeError("db down")
        return self._graph


class _Graph:
    """Stand-in for the Pydantic Graph model — exposes only model_dump."""

    def __init__(self, payload: dict):
        """Init."""
        self._payload = payload

    def model_dump(self, **kwargs) -> dict:
        """Model dump."""
        return self._payload


async def test_seq_starts_at_zero_and_is_monotonic():
    """Seq starts at zero and is monotonic."""
    room = Room(board_id="b1")
    assert room.seq == 0

    async with room.lock:
        assert room.next_seq_unlocked() == 1
        assert room.next_seq_unlocked() == 2
        assert room.next_seq_unlocked() == 3


async def test_build_welcome_returns_current_seq_and_dumped_graph():
    """Build welcome returns current seq and dumped graph."""
    room = Room(board_id="b1")
    async with room.lock:
        room.next_seq_unlocked()  # seq → 1
    store = _StaticGraphStore(graph=_Graph({"id": "b1", "nodes": []}))

    env = await build_welcome_snapshot(
        graph_store=store, room=room, board_id="b1",
    )

    assert env.seq == 1
    assert env.graph == {"id": "b1", "nodes": []}
    assert store.calls == [{"graph_uid": "b1", "root_id": None}]


async def test_build_welcome_empty_graph_returns_empty_dict():
    """Build welcome empty graph returns empty dict."""
    room = Room(board_id="b1")
    store = _StaticGraphStore(graph=None)

    env = await build_welcome_snapshot(
        graph_store=store, room=room, board_id="b1",
    )

    assert env.seq == 0
    assert env.graph == {}


async def test_build_welcome_swallows_db_failure():
    """Build welcome swallows db failure."""
    room = Room(board_id="b1")
    store = _StaticGraphStore(raise_on_read=True)

    env = await build_welcome_snapshot(
        graph_store=store, room=room, board_id="b1",
    )

    assert env.seq == 0
    assert env.graph == {}


async def test_seq_does_not_advance_while_welcome_holds_lock():
    """Welcome snapshot serializes against apply-side seq increments.

    The lock held by build_welcome_snapshot must block other seq
    bumps — otherwise a late-joiner could see a seq that's already
    missed an op in the snapshot read.
    """
    room = Room(board_id="b1")
    seen_seq_during_read = []
    permission_to_finish_read = asyncio.Event()

    class _SlowGraphStore:
        async def get_graph(self, *, graph_uid: str, root_id: str | None = None):
            # Inside the lock — give the test a chance to attempt a seq bump.
            """Get graph."""
            await permission_to_finish_read.wait()
            return None

    store = _SlowGraphStore()

    welcome_task = asyncio.create_task(
        build_welcome_snapshot(graph_store=store, room=room, board_id="b1")
    )

    await asyncio.sleep(0)  # let welcome acquire the lock

    async def attempt_bump():
        """Attempt bump."""
        async with room.lock:
            seen_seq_during_read.append(room.next_seq_unlocked())

    bump_task = asyncio.create_task(attempt_bump())
    await asyncio.sleep(0.05)

    # The bump can't have run yet — welcome owns the lock.
    assert seen_seq_during_read == []

    permission_to_finish_read.set()
    env = await welcome_task
    await bump_task

    assert env.seq == 0
    # The bump now sees the post-welcome seq, advancing to 1.
    assert seen_seq_during_read == [1]
