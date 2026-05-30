"""Tests for the per-room ring buffer + `batches_since_unlocked` slicing.

Phase 1c.2 adds catch-up mode to the WS welcome handshake: a
reconnecting client passes its last-known `since_seq` and the server
returns the batches that happened in `(since_seq, room.seq]` — only if
those batches are still in the ring. Drift past the buffer floor falls
back to a snapshot rebuild (handled in the router).
"""

import pytest

from topix.collab.room import ROOM_BUFFER_CAP, Room


@pytest.mark.asyncio
async def test_remember_and_slice_returns_post_since_batches() -> None:
    """Batches with `seq > since_seq` are returned in seq order."""
    room = Room(board_id="b1")
    async with room.lock:
        for i in range(1, 6):
            seq = room.next_seq_unlocked()
            room.remember_batch_unlocked(seq, {"id": f"b{i}"})
        sliced = room.batches_since_unlocked(2)

    assert [b["id"] for b in sliced] == ["b3", "b4", "b5"]


@pytest.mark.asyncio
async def test_slice_at_current_seq_is_empty_not_none() -> None:
    """`since_seq == room.seq` → empty list (peer is already live)."""
    room = Room(board_id="b1")
    async with room.lock:
        seq = room.next_seq_unlocked()
        room.remember_batch_unlocked(seq, {"id": "b1"})
        sliced = room.batches_since_unlocked(1)

    assert sliced == []


@pytest.mark.asyncio
async def test_slice_past_buffer_floor_returns_none() -> None:
    """Drifted reconnect (past the oldest buffered seq) → None.

    Caller (`_send_welcome`) interprets None as "fall back to snapshot
    mode". With ROOM_BUFFER_CAP entries, anything older than the
    oldest entry has been evicted.
    """
    room = Room(board_id="b1")
    async with room.lock:
        # Fill beyond cap so the early entries are evicted.
        for _ in range(ROOM_BUFFER_CAP + 50):
            seq = room.next_seq_unlocked()
            room.remember_batch_unlocked(seq, {"id": f"b{seq}"})
        # since_seq=10 is way before the oldest remaining seq.
        sliced = room.batches_since_unlocked(10)

    assert sliced is None


@pytest.mark.asyncio
async def test_slice_with_empty_buffer_at_seq_zero_is_empty_list() -> None:
    """Empty buffer + since_seq == room.seq == 0 → empty list, not None.

    Avoids a spurious snapshot fallback when a fresh room and a fresh
    client agree the world is at seq 0 (e.g., reconnect immediately
    after first ever connect with no ops in between).
    """
    room = Room(board_id="b1")
    sliced = room.batches_since_unlocked(0)
    assert sliced == []


@pytest.mark.asyncio
async def test_buffer_caps_at_room_buffer_cap() -> None:
    """The deque silently drops oldest entries past the cap.

    Verifies the deque maxlen is wired and that the boundary entry
    can still be retrieved via `batches_since_unlocked`.
    """
    room = Room(board_id="b1")
    async with room.lock:
        for _ in range(ROOM_BUFFER_CAP + 100):
            seq = room.next_seq_unlocked()
            room.remember_batch_unlocked(seq, {"id": f"b{seq}"})

    # Oldest preserved seq is room.seq - (cap - 1).
    expected_oldest = room.seq - (ROOM_BUFFER_CAP - 1)
    assert room._buffer[0][0] == expected_oldest
    # Slicing just before the oldest seq still returns the full ring.
    async with room.lock:
        sliced = room.batches_since_unlocked(expected_oldest - 1)
    assert sliced is not None
    assert len(sliced) == ROOM_BUFFER_CAP


@pytest.mark.asyncio
async def test_slice_returns_ordered_consecutive_seqs() -> None:
    """The returned batches are in seq-ascending order with no gaps."""
    room = Room(board_id="b1")
    async with room.lock:
        for _ in range(20):
            seq = room.next_seq_unlocked()
            room.remember_batch_unlocked(seq, {"seq": seq})
        sliced = room.batches_since_unlocked(7)

    assert [b["seq"] for b in sliced] == list(range(8, 21))
