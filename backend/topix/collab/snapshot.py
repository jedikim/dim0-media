"""Atomic `(snapshot, seq)` reader for the welcome handshake.

A late-joiner needs a pair such that no op has been applied after `seq`
that isn't already reflected in `snapshot`. The simplest correct way to
guarantee this is to read both under the room's lock so no apply can
interleave between the two reads.

Holding the lock across `graph_store.get_graph()` pauses live ops in
the room for the duration of the DB read (typically <500ms). A future
optimization (collab-archi.md §10 Risk #2) is to capture `seq` then
read the graph outside the lock and buffer outgoing peer-ops to the
joiner until they ack the welcome.
"""

import logging

from dataclasses import dataclass
from typing import Any

from topix.collab.room import Room
from topix.store.graph import GraphStore

logger = logging.getLogger(__name__)


@dataclass
class SnapshotEnvelope:
    """Payload of the `welcome` message a joining client receives."""

    seq: int
    graph: dict[str, Any]


async def read_snapshot_payload(
    *,
    graph_store: GraphStore,
    board_id: str,
    root_id: str | None = None,
) -> dict[str, Any]:
    """Read the board graph and dump it to JSON.

    No locking — the caller decides whether the read needs to be
    serialized. Returns `{}` when the board has no graph yet or the
    read raises; we'd rather emit an empty welcome than crash the WS
    handshake.
    """
    try:
        graph = await graph_store.get_graph(graph_uid=board_id, root_id=root_id)
    except Exception:
        logger.exception("collab snapshot read failed board=%s", board_id)
        return {}
    return graph.model_dump(exclude_none=True) if graph else {}


async def build_welcome_snapshot(
    *,
    graph_store: GraphStore,
    room: Room,
    board_id: str,
    root_id: str | None = None,
) -> SnapshotEnvelope:
    """Acquire `room.lock`, read `(seq, graph)`, release.

    Convenience wrapper used by tests and ad-hoc callers. The WS
    handler inlines lock + welcome-send instead of using this — it
    must keep the lock held *through* the send so a concurrent op
    can't broadcast a `peer-op` ahead of the joiner's `welcome`.
    """
    async with room.lock:
        seq = room.seq
        payload = await read_snapshot_payload(
            graph_store=graph_store, board_id=board_id, root_id=root_id,
        )
    return SnapshotEnvelope(seq=seq, graph=payload)
