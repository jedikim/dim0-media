"""Tests for AgentBoardBridge.

Server-side mutations should both persist via GraphStore *and*
broadcast a `peer-op` to live peers in the relevant Room.
"""

import asyncio
import json

from typing import Any

from topix.collab.agent_bridge import AGENT_CLIENT_ID, AgentBoardBridge
from topix.collab.room import RoomRegistry
from topix.datatypes.note.link import Link
from topix.datatypes.note.note import GENERATED_IMAGE_MARKER_VALUE, Note, NoteProperties
from topix.datatypes.property import KeywordProperty, SizeProperty
from topix.datatypes.resource import RichText


class _FakeSocket:
    def __init__(self):
        """Init."""
        self.sent: list[str] = []

    async def send_text(self, raw: str) -> None:
        """Send text."""
        self.sent.append(raw)


class _RecordingGraphStore:
    """Records each backing call for the bridge's persist step."""

    def __init__(self):
        """Init."""
        self.add_notes_calls: list[list[Note]] = []
        self.patch_calls: list[dict[str, Any]] = []
        self.delete_node_calls: list[dict[str, Any]] = []
        self.add_links_calls: list[list[Link]] = []
        self.delete_link_calls: list[str] = []
        # patch_note returns the post-merge note; we just echo the
        # data dict back wrapped in a Note for tests to inspect.
        self.patch_returns: Note | None = None
        # nodes_by_uid powers get_nodes() — tests that exercise the
        # bridge's edge-endpoint resolver populate this.
        self.nodes_by_uid: dict[str, Note] = {}

    async def add_notes(self, *, nodes):
        """Add notes."""
        self.add_notes_calls.append(nodes)

    async def patch_note(self, *, node_id, data, user_uid):
        """Patch note."""
        self.patch_calls.append({"node_id": node_id, "data": data, "user_uid": user_uid})
        return self.patch_returns or Note(id=node_id, graph_uid="b1")

    async def delete_node(self, *, node_id, user_uid):
        """Delete node."""
        self.delete_node_calls.append({"node_id": node_id, "user_uid": user_uid})

    async def add_links(self, *, links):
        """Add links."""
        self.add_links_calls.append(links)

    async def delete_link(self, *, link_id):
        """Delete link."""
        self.delete_link_calls.append(link_id)

    async def get_nodes(self, node_ids):
        """Return the requested notes (used by the bridge's endpoint resolver)."""
        return [self.nodes_by_uid[uid] for uid in node_ids if uid in self.nodes_by_uid]


class _FakeOplog:
    """In-memory stand-in for CollabOplogStore (no DB/Redis in unit tests)."""

    def __init__(self):
        """Init per-board seq counters + captured appends."""
        self._seq: dict[str, int] = {}
        self.appended: list[tuple[str, int, dict]] = []

    async def next_seq(self, board_id: str) -> int:
        """Return a monotonic per-board seq starting at 1."""
        self._seq[board_id] = self._seq.get(board_id, 0) + 1
        return self._seq[board_id]

    async def append(self, board_id: str, seq: int, batch: dict) -> bool:
        """Capture the appended batch."""
        self.appended.append((board_id, seq, batch))
        return True


def _make_note(note_id: str = "n1", *, w: float | None = None, h: float | None = None) -> Note:
    """Build a Note for tests.

    Optionally seeds `node_size` for the endpoint-resolver path in
    `bridge.add_links`.
    """
    properties = None
    if w is not None or h is not None:
        properties = NoteProperties(
            node_size=SizeProperty(size=SizeProperty.Size(width=w or 300, height=h or 100)),
        )
    return Note(
        id=note_id,
        graph_uid="b1",
        label=RichText(markdown="Hi"),
        content=RichText(markdown="body"),
        properties=properties or NoteProperties(),
    )


async def test_add_notes_persists_and_broadcasts_when_room_exists():
    """Add notes persists and broadcasts when room exists."""
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    # Pre-seed a room with one connected client.
    sock = _FakeSocket()
    room, _ = await registry.join("b1", sock, "u1")

    note = _make_note()
    await bridge.add_notes(board_id="b1", notes=[note])

    # Persisted via GraphStore
    assert store.add_notes_calls == [[note]]
    # Broadcast as peer-op to the connected client
    assert len(sock.sent) == 1
    msg = json.loads(sock.sent[0])
    assert msg["kind"] == "peer-op"
    assert msg["seq"] == 1
    assert msg["batch"]["clientId"] == AGENT_CLIENT_ID
    assert msg["batch"]["is_system"] is True
    assert msg["batch"]["origin"] == "remote"
    assert len(msg["batch"]["ops"]) == 1
    assert msg["batch"]["ops"][0]["type"] == "node.add"
    assert msg["batch"]["ops"][0]["node"]["id"] == "n1"


async def test_generated_result_node_and_edge_use_durable_peer_ops():
    """Generated results project through the ordinary oplog/broadcast path."""
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    oplog = _FakeOplog()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=oplog)
    socket = _FakeSocket()
    await registry.join("b1", socket, "u1")
    generator = _make_note("generator", w=300, h=200)
    result = Note(
        id="result",
        graph_uid="b1",
        properties=NoteProperties(
            image_asset_uid=KeywordProperty(value="a" * 32),
            generated_image_marker=KeywordProperty(value=GENERATED_IMAGE_MARKER_VALUE),
            generated_image_generation_uid=KeywordProperty(value="g" * 32),
            generated_image_generator_node_uid=KeywordProperty(value=generator.id),
        ),
    )
    store.nodes_by_uid.update({generator.id: generator, result.id: result})

    await bridge.add_notes(board_id="b1", notes=[result])
    await bridge.add_links(
        board_id="b1",
        links=[Link(id="edge", source=generator.id, target=result.id, graph_uid="b1")],
    )

    assert [entry[1] for entry in oplog.appended] == [1, 2]
    node_op = json.loads(socket.sent[0])["batch"]["ops"][0]
    edge_op = json.loads(socket.sent[1])["batch"]["ops"][0]
    assert node_op["type"] == "node.add"
    assert node_op["node"]["type"] == "generated-image"
    assert node_op["node"]["data"]["properties"]["imageAssetUid"]["value"] == "a" * 32
    assert edge_op["type"] == "edge.add"
    assert edge_op["edge"]["source"]["nodeId"] == generator.id
    assert edge_op["edge"]["target"]["nodeId"] == result.id
    assert "imageReference" not in edge_op["edge"]["data"]


async def test_no_broadcast_when_no_room_exists():
    """With no live session, only the persist step runs."""
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    note = _make_note()
    await bridge.add_notes(board_id="b1", notes=[note])

    assert store.add_notes_calls == [[note]]
    assert registry.get("b1") is None


async def test_patch_note_broadcasts_node_update():
    """Patch note broadcasts node update."""
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    await bridge.patch_note(
        board_id="b1",
        node_id="n1",
        data={
            "properties": {
                "node_position": {
                    "type": "position",
                    "position": {"x": 200, "y": 150},
                }
            }
        },
        user_uid=None,
    )

    assert len(store.patch_calls) == 1
    msg = json.loads(sock.sent[0])
    assert msg["batch"]["ops"][0]["type"] == "node.update"
    assert msg["batch"]["ops"][0]["id"] == "n1"
    assert msg["batch"]["ops"][0]["patch"] == {"x": 200.0, "y": 150.0}


async def test_patch_note_with_unsupported_patch_still_persists():
    """Patch with no scene-graph fields persists but skips the broadcast.

    Such a patch produces an empty wire patch, so the bridge sends no
    `peer-op` (no observable op for peers).
    """
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    await bridge.patch_note(
        board_id="b1",
        node_id="n1",
        data={"style": {"fontFamily": "serif"}},
        user_uid=None,
    )

    assert len(store.patch_calls) == 1
    # No wire patch fields → no peer-op
    assert sock.sent == []


async def test_delete_node_broadcasts_node_remove():
    """Delete node broadcasts node remove."""
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    await bridge.delete_node(board_id="b1", node_id="n9", user_uid="u1")

    assert store.delete_node_calls == [{"node_id": "n9", "user_uid": "u1"}]
    msg = json.loads(sock.sent[0])
    assert msg["batch"]["ops"][0] == {"type": "node.remove", "node": {"id": "n9"}}


async def test_add_links_broadcasts_edge_add():
    """add_links broadcasts edge.add with localOffset defaulted to node center.

    Without `localOffset`, canvas-harness's projectEndToWorld crashes
    on `undefined.x`. The bridge resolves source/target node sizes
    via get_nodes and defaults the offset to `(w/2, h/2)`.
    """
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    # Seed the recording store with notes whose node_size we can
    # exercise in the resolver.
    store.nodes_by_uid["a"] = _make_note("a", w=200, h=100)
    store.nodes_by_uid["b"] = _make_note("b", w=400, h=80)
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    link = Link(source="a", target="b", graph_uid="b1")
    await bridge.add_links(board_id="b1", links=[link])

    assert store.add_links_calls == [[link]]
    msg = json.loads(sock.sent[0])
    op = msg["batch"]["ops"][0]
    assert op["type"] == "edge.add"
    assert op["edge"]["source"] == {
        "nodeId": "a",
        "localOffset": {"x": 100.0, "y": 50.0},
    }
    assert op["edge"]["target"] == {
        "nodeId": "b",
        "localOffset": {"x": 200.0, "y": 40.0},
    }


async def test_add_links_broadcasts_full_edge_shape():
    """edge.add carries pathStyle, label, style, groups, and _storedColors.

    canvas-harness's `Edge` requires `pathStyle` (non-optional) — without
    it, `samplesFor` returns undefined and `edgeAABBFromSamples` crashes
    on `.length`. The agent path also ships content (label), the
    EdgeStyle camelCase subset, and `_storedColors` for theme adaptation
    on the receiver.
    """
    from topix.datatypes.note.style import (
        Arrowhead,
        LinkStyle,
        PathStyle,
        StrokeStyle,
    )

    registry = RoomRegistry()
    store = _RecordingGraphStore()
    store.nodes_by_uid["a"] = _make_note("a", w=200, h=100)
    store.nodes_by_uid["b"] = _make_note("b", w=200, h=100)
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    link = Link(
        source="a",
        target="b",
        graph_uid="b1",
        label=RichText(markdown="connector"),
        style=LinkStyle(
            stroke_color="#0a0a0a",
            stroke_width=3,
            stroke_style=StrokeStyle.DASHED,
            text_color="#222222",
            path_style=PathStyle.STRAIGHT,
            source_arrowhead=Arrowhead.BARB,
            target_arrowhead=Arrowhead.ARROW_FILLED,
            group_ids=["g1"],
        ),
    )
    await bridge.add_links(board_id="b1", links=[link])

    msg = json.loads(sock.sent[0])
    edge = msg["batch"]["ops"][0]["edge"]
    assert edge["pathStyle"] == "straight"
    assert edge["content"] == "connector"
    assert edge["groups"] == ["g1"]
    assert edge["style"]["strokeColor"] == "#0a0a0a"
    assert edge["style"]["strokeWidth"] == 3
    assert edge["style"]["strokeStyle"] == "dashed"
    assert edge["style"]["textColor"] == "#222222"
    assert edge["style"]["sourceArrowhead"] == "barb"
    assert edge["style"]["targetArrowhead"] == "arrow-filled"
    # Lifted onto Edge.pathStyle — not duplicated inside `style`.
    assert "pathStyle" not in edge["style"]
    # Canonical colors mirror the canvas-harness Node convention so the
    # receiver can re-adapt for its local theme.
    assert edge["data"]["_storedColors"] == {
        "strokeColor": "#0a0a0a",
        "backgroundColor": "#00000000",
        "textColor": "#222222",
    }


async def test_link_to_wire_uses_saved_local_offset_over_node_center():
    """The wire's `localOffset` reflects the stored `start_point` position.

    Regression check: `link_to_wire_edge` used to ignore the stored
    position entirely and always default to node center via
    `node_sizes`. That meant edges with a user-chosen attachment
    point (e.g., top-edge of a box) lost their position the moment
    the agent or any other server-side path broadcast them.
    """
    from topix.collab.note_to_wire import link_to_wire_edge
    from topix.datatypes.note.link import Link, LinkProperties
    from topix.datatypes.property import PositionProperty

    link = Link(
        source="a",
        target="b",
        graph_uid="b1",
        properties=LinkProperties(
            start_point=PositionProperty(
                position=PositionProperty.Position(x=50, y=30),
                is_local_offset=True,
            ),
            end_point=PositionProperty(
                position=PositionProperty.Position(x=180, y=10),
                is_local_offset=True,
            ),
        ),
    )

    wire = link_to_wire_edge(link, node_sizes={"a": (200, 100), "b": (200, 100)})

    # Stored localOffset wins over the (w/2, h/2) center fallback.
    assert wire["source"] == {"nodeId": "a", "localOffset": {"x": 50.0, "y": 30.0}}
    assert wire["target"] == {"nodeId": "b", "localOffset": {"x": 180.0, "y": 10.0}}


async def test_link_to_wire_emits_world_point_for_free_endpoint():
    """A Link with empty-string source ships `{worldPoint}` on the wire.

    Companion to the inbound side: free endpoints now make a full
    round-trip through the WS path without being silently dropped.
    """
    from topix.collab.note_to_wire import link_to_wire_edge
    from topix.datatypes.note.link import Link, LinkProperties
    from topix.datatypes.property import PositionProperty

    link = Link(
        source="",  # free
        target="b",  # attached
        graph_uid="b1",
        properties=LinkProperties(
            start_point=PositionProperty(
                position=PositionProperty.Position(x=900, y=500),
                is_local_offset=False,
            ),
            end_point=PositionProperty(
                position=PositionProperty.Position(x=100, y=50),
                is_local_offset=True,
            ),
        ),
    )

    wire = link_to_wire_edge(link, node_sizes={"b": (200, 100)})

    assert wire["source"] == {"worldPoint": {"x": 900.0, "y": 500.0}}
    assert wire["target"] == {"nodeId": "b", "localOffset": {"x": 100.0, "y": 50.0}}


async def test_add_links_defaults_path_style_to_bezier():
    """A link without an explicit path_style still ships `pathStyle: 'bezier'`."""
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    store.nodes_by_uid["a"] = _make_note("a", w=100, h=100)
    store.nodes_by_uid["b"] = _make_note("b", w=100, h=100)
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    link = Link(source="a", target="b", graph_uid="b1")
    await bridge.add_links(board_id="b1", links=[link])

    msg = json.loads(sock.sent[0])
    edge = msg["batch"]["ops"][0]["edge"]
    assert edge["pathStyle"] == "bezier"


async def test_add_links_falls_back_to_zero_offset_when_node_missing():
    """If `get_nodes` doesn't return a node, localOffset falls back to (0, 0).

    Avoids crashing the wire path when an agent emits a link to a node
    the server can't immediately resolve (race / inconsistent state).
    """
    registry = RoomRegistry()
    store = _RecordingGraphStore()  # nodes_by_uid intentionally empty
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    link = Link(source="missing", target="also-missing", graph_uid="b1")
    await bridge.add_links(board_id="b1", links=[link])

    msg = json.loads(sock.sent[0])
    op = msg["batch"]["ops"][0]
    assert op["edge"]["source"] == {
        "nodeId": "missing",
        "localOffset": {"x": 0.0, "y": 0.0},
    }
    assert op["edge"]["target"] == {
        "nodeId": "also-missing",
        "localOffset": {"x": 0.0, "y": 0.0},
    }


async def test_bridge_broadcast_lands_in_ring_buffer():
    """Agent broadcasts are recorded in `Room._buffer` for reconnect catch-up.

    Without this, a peer reconnecting via `since_seq` after the agent
    ran would miss the agent's ops entirely (the buffer would only
    contain human-initiated batches). Locks down that the bridge
    integrates with the same ring used by the WS op handler.
    """
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    room, _ = await registry.join("b1", sock, "u1")

    await bridge.add_notes(board_id="b1", notes=[_make_note("n1")])

    async with room.lock:
        buffered = room.batches_since_unlocked(0)

    assert buffered is not None
    assert len(buffered) == 1
    assert buffered[0]["clientId"] == AGENT_CLIENT_ID
    # The buffered batch is the same shape that was broadcast.
    assert buffered[0]["ops"][0]["type"] == "node.add"


async def test_seq_is_monotonic_per_room():
    """Seq is monotonic per room."""
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    await bridge.add_notes(board_id="b1", notes=[_make_note("n1")])
    await bridge.delete_node(board_id="b1", node_id="n1", user_uid="u1")
    await bridge.add_notes(board_id="b1", notes=[_make_note("n2")])

    seqs = [json.loads(s)["seq"] for s in sock.sent]
    assert seqs == [1, 2, 3]


async def test_broadcast_runs_under_same_lock_as_seq_assignment():
    """Concurrent bridge calls must serialize cleanly.

    Strictly increasing seqs and per-peer-ordered peer-op frames.
    """
    registry = RoomRegistry()
    store = _RecordingGraphStore()
    bridge = AgentBoardBridge(graph_store=store, registry=registry, oplog=_FakeOplog())

    sock = _FakeSocket()
    await registry.join("b1", sock, "u1")

    await asyncio.gather(*[bridge.delete_node(board_id="b1", node_id=f"n{i}", user_uid="u1") for i in range(10)])

    seqs = [json.loads(s)["seq"] for s in sock.sent]
    assert seqs == sorted(seqs)
    assert seqs[0] == 1
    assert seqs[-1] == 10
