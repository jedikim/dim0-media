"""Tests for the post-turn flex-wrap / Sugiyama rearrange pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from topix.agents.notes.layout import (
    TILE_GAP_X,
    _connected_components,
    rearrange_created_notes,
)
from topix.datatypes.note.link import Link
from topix.datatypes.note.note import Note
from topix.datatypes.property import PositionProperty, SizeProperty


def _make_note(
    note_id: str,
    graph_uid: str = "graph-1",
    x: float = 0.0,
    y: float = 0.0,
    width: float = 300.0,
    height: float = 100.0,
) -> Note:
    note = Note(id=note_id, graph_uid=graph_uid)
    note.properties.node_position = PositionProperty(
        position=PositionProperty.Position(x=x, y=y),
    )
    note.properties.node_size = SizeProperty(
        size=SizeProperty.Size(width=width, height=height),
    )
    return note


@dataclass
class _FakeGraph:
    nodes: list[Note]
    edges: list[Link]


@dataclass
class _FakeGraphStore:
    """Minimal in-memory stub of GraphStore for layout tests."""

    notes: dict[str, Note] = field(default_factory=dict)
    links: list[Link] = field(default_factory=list)
    patches: list[tuple[str, dict]] = field(default_factory=list)

    async def get_nodes(self, note_ids: list[str]) -> list[Note]:
        return [self.notes[nid] for nid in note_ids if nid in self.notes]

    async def get_links(self, link_ids: list[str]) -> list[Link]:
        requested = set(link_ids)
        return [link for link in self.links if link.id in requested]

    async def get_graph(self, graph_uid: str, root_id: str | None = None) -> _FakeGraph:
        scoped_nodes = [
            n for n in self.notes.values()
            if n.graph_uid == graph_uid
            and (
                (root_id is None and n.parent_id is None)
                or (root_id is not None and n.parent_id == root_id)
            )
        ]
        scoped_links = [link for link in self.links if link.graph_uid == graph_uid]
        return _FakeGraph(nodes=scoped_nodes, edges=scoped_links)

    async def patch_note(self, note_id: str, data: dict) -> Note | None:
        self.patches.append((note_id, data))
        note = self.notes.get(note_id)
        if note is None:
            return None
        position = data.get("properties", {}).get("node_position", {}).get("position")
        if position is not None:
            note.properties.node_position = PositionProperty(
                position=PositionProperty.Position(x=position["x"], y=position["y"]),
            )
        return note


def _patched_position(store: _FakeGraphStore, note_id: str) -> dict[str, float]:
    """Read the (last) position written to a note via patch_note."""
    for nid, data in reversed(store.patches):
        if nid == note_id:
            return data["properties"]["node_position"]["position"]
    raise AssertionError(f"note {note_id} was never patched")


# -----------------------------
# Component discovery
# -----------------------------

def test_connected_components_preserves_input_order() -> None:
    """Components should be returned in the order their first member appears in the input."""
    edges = [("a", "b"), ("c", "d")]
    comps = _connected_components(["a", "b", "c", "d", "e"], edges)

    assert comps == [["a", "b"], ["c", "d"], ["e"]]


# -----------------------------
# rearrange_created_notes end-to-end
# -----------------------------

@pytest.mark.asyncio
async def test_rearrange_skips_when_less_than_two_created_ids() -> None:
    """Single-note turns should not trigger a reshuffle."""
    store = _FakeGraphStore(notes={"a": _make_note("a")})

    moved = await rearrange_created_notes(store, "graph-1", ["a"])

    assert moved == []
    assert store.patches == []


@pytest.mark.asyncio
async def test_rearrange_skips_when_notes_absent_from_scope() -> None:
    """If the created ids do not belong to the target board, nothing is moved."""
    store = _FakeGraphStore(notes={"a": _make_note("a", graph_uid="other")})

    moved = await rearrange_created_notes(store, "graph-1", ["a", "b"])

    assert moved == []
    assert store.patches == []


@pytest.mark.asyncio
async def test_rearrange_flex_wraps_singletons_into_rows() -> None:
    """Wide enough tiles should wrap onto a new row once the row-width budget is exceeded."""
    note_ids = [f"n{i}" for i in range(8)]
    store = _FakeGraphStore(
        notes={nid: _make_note(nid, width=1000.0, height=100.0) for nid in note_ids},
    )

    moved = await rearrange_created_notes(
        store, "graph-1", note_ids, max_row_width=3500.0, h_gap=80.0, v_gap=40.0,
    )

    assert set(moved) == set(note_ids)
    by_id = {nid: _patched_position(store, nid) for nid in note_ids}
    # Row 1: n0, n1, n2 share the same y.
    assert by_id["n0"]["y"] == by_id["n1"]["y"] == by_id["n2"]["y"]
    # n3 wraps to a new row (row_width 4320 > 3500).
    assert by_id["n3"]["y"] > by_id["n2"]["y"]
    assert by_id["n3"]["y"] == pytest.approx(by_id["n2"]["y"] + 100.0 + 40.0)
    # Each row tiles increase x.
    assert by_id["n1"]["x"] > by_id["n0"]["x"]
    assert by_id["n2"]["x"] > by_id["n1"]["x"]


@pytest.mark.asyncio
async def test_rearrange_never_moves_notes_outside_created_ids() -> None:
    """Notes that were not created in this turn must never be repositioned."""
    untouched = _make_note("keep-me", x=5000.0, y=5000.0)
    store = _FakeGraphStore(
        notes={
            "keep-me": untouched,
            "new-a": _make_note("new-a"),
            "new-b": _make_note("new-b"),
        },
    )

    await rearrange_created_notes(store, "graph-1", ["new-a", "new-b"])

    touched_ids = {nid for nid, _ in store.patches}
    assert "keep-me" not in touched_ids
    assert touched_ids == {"new-a", "new-b"}
    assert untouched.properties.node_position.position.x == 5000.0
    assert untouched.properties.node_position.position.y == 5000.0


@pytest.mark.asyncio
async def test_rearrange_layouts_two_child_tree_bidirectionally() -> None:
    """A tree with >=2 children of root splits left/right of the center node."""
    link_a = Link(source="root", target="a", graph_uid="graph-1")
    link_b = Link(source="root", target="b", graph_uid="graph-1")
    store = _FakeGraphStore(
        notes={
            nid: _make_note(nid, width=200.0, height=100.0)
            for nid in ["root", "a", "b", "solo1", "solo2"]
        },
        links=[link_a, link_b],
    )

    moved = await rearrange_created_notes(
        store, "graph-1", ["root", "a", "b", "solo1", "solo2"],
        created_link_ids=[link_a.id, link_b.id],
        max_row_width=10000.0,
    )

    assert set(moved) == {"root", "a", "b", "solo1", "solo2"}
    by_id = {nid: _patched_position(store, nid) for nid in moved}
    # Bidirectional: one child sits to the right of root, the other to the left.
    sides = {nid: by_id[nid]["x"] - by_id["root"]["x"] for nid in ("a", "b")}
    assert (sides["a"] > 0 and sides["b"] < 0) or (sides["a"] < 0 and sides["b"] > 0)


@pytest.mark.asyncio
async def test_rearrange_balances_subtrees_across_sides() -> None:
    """Greedy balance: a 4-child root with one heavy + three light subtrees splits ~evenly."""
    # Root → big_branch → big_a, big_b (subtree size 3); root → c, d, e (each size 1).
    links = [
        Link(source="root", target="big_branch", graph_uid="graph-1"),
        Link(source="big_branch", target="big_a", graph_uid="graph-1"),
        Link(source="big_branch", target="big_b", graph_uid="graph-1"),
        Link(source="root", target="c", graph_uid="graph-1"),
        Link(source="root", target="d", graph_uid="graph-1"),
        Link(source="root", target="e", graph_uid="graph-1"),
    ]
    store = _FakeGraphStore(
        notes={
            nid: _make_note(nid, width=200.0, height=100.0)
            for nid in ["root", "big_branch", "big_a", "big_b", "c", "d", "e"]
        },
        links=links,
    )

    await rearrange_created_notes(
        store, "graph-1",
        ["root", "big_branch", "big_a", "big_b", "c", "d", "e"],
        created_link_ids=[link.id for link in links],
    )

    by_id = {nid: _patched_position(store, nid)["x"] for nid in ["root", "big_branch", "c", "d", "e"]}
    # Big branch (size 3) takes one side; the three singletons share the other.
    big_side = "right" if by_id["big_branch"] > by_id["root"] else "left"
    singleton_xs = [by_id["c"], by_id["d"], by_id["e"]]
    if big_side == "right":
        assert all(x < by_id["root"] for x in singleton_xs)
    else:
        assert all(x > by_id["root"] for x in singleton_xs)


@pytest.mark.asyncio
async def test_rearrange_keeps_lr_for_single_child_chain() -> None:
    """A chain (root → a → b) stays in single-direction LR; mindmap mode is gated on >=2 children."""
    links = [
        Link(source="root", target="a", graph_uid="graph-1"),
        Link(source="a", target="b", graph_uid="graph-1"),
    ]
    store = _FakeGraphStore(
        notes={
            nid: _make_note(nid, width=200.0, height=100.0)
            for nid in ["root", "a", "b"]
        },
        links=links,
    )

    await rearrange_created_notes(
        store, "graph-1", ["root", "a", "b"],
        created_link_ids=[link.id for link in links],
    )

    by_id = {nid: _patched_position(store, nid)["x"] for nid in ["root", "a", "b"]}
    # All three flow strictly rightward.
    assert by_id["root"] < by_id["a"] < by_id["b"]


@pytest.mark.asyncio
async def test_rearrange_lays_out_dag_component_as_layered_ranks() -> None:
    """Multi-parent DAGs are laid out by Sugiyama, not collapsed to a single line."""
    link_ac = Link(source="a", target="c", graph_uid="graph-1")
    link_bc = Link(source="b", target="c", graph_uid="graph-1")
    store = _FakeGraphStore(
        notes={
            nid: _make_note(nid, width=200.0, height=100.0)
            for nid in ["a", "b", "c"]
        },
        links=[link_ac, link_bc],
    )

    await rearrange_created_notes(
        store, "graph-1", ["a", "b", "c"],
        created_link_ids=[link_ac.id, link_bc.id],
    )

    by_id = {nid: _patched_position(store, nid) for nid in ["a", "b", "c"]}
    # In LR Sugiyama, a and b feed c → c sits to the right of both.
    assert by_id["c"]["x"] > by_id["a"]["x"]
    assert by_id["c"]["x"] > by_id["b"]["x"]
    # a and b share a rank (same x), distinct y.
    assert by_id["a"]["x"] == pytest.approx(by_id["b"]["x"])
    assert by_id["a"]["y"] != by_id["b"]["y"]


@pytest.mark.asyncio
async def test_rearrange_handles_cycle_via_feedback_arc_set() -> None:
    """A cycle (a→b→c→a) is laid out by Sugiyama instead of collapsing to one line."""
    link_ab = Link(source="a", target="b", graph_uid="graph-1")
    link_bc = Link(source="b", target="c", graph_uid="graph-1")
    link_ca = Link(source="c", target="a", graph_uid="graph-1")
    store = _FakeGraphStore(
        notes={
            nid: _make_note(nid, width=200.0, height=100.0)
            for nid in ["a", "b", "c"]
        },
        links=[link_ab, link_bc, link_ca],
    )

    await rearrange_created_notes(
        store, "graph-1", ["a", "b", "c"],
        created_link_ids=[link_ab.id, link_bc.id, link_ca.id],
    )

    by_id = {nid: _patched_position(store, nid) for nid in ["a", "b", "c"]}
    # Sugiyama removes a feedback arc, so the three nodes occupy at least two distinct
    # ranks (xs) — they no longer pile up on a single horizontal line.
    distinct_xs = {round(by_id[nid]["x"], 4) for nid in ["a", "b", "c"]}
    assert len(distinct_xs) >= 2


@pytest.mark.asyncio
async def test_rearrange_ignores_links_not_in_created_link_ids() -> None:
    """Links that weren't explicitly passed as created must not form components.

    Guards against the old behavior of scrolling the graph for edges, which could return
    stale data right after write or pull in links from a prior turn.
    """
    existing_link = Link(source="a", target="b", graph_uid="graph-1")
    store = _FakeGraphStore(
        notes={
            nid: _make_note(nid, width=200.0, height=100.0)
            for nid in ["a", "b"]
        },
        links=[existing_link],
    )

    await rearrange_created_notes(store, "graph-1", ["a", "b"])

    by_id = {nid: _patched_position(store, nid) for nid in ["a", "b"]}
    # Two singletons side by side, not a 2-node connected component.
    assert by_id["a"]["y"] == by_id["b"]["y"]
    assert abs(by_id["a"]["x"] - by_id["b"]["x"]) == pytest.approx(200.0 + TILE_GAP_X)


@pytest.mark.asyncio
async def test_rearrange_anchors_below_existing_board_content() -> None:
    """New tiles must land below the existing board's bottom edge, not on top of it."""
    from topix.agents.notes.service import DEFAULT_NOTE_GAP

    store = _FakeGraphStore(
        notes={
            "existing": _make_note("existing", x=100.0, y=150.0, width=200.0, height=100.0),
            "a": _make_note("a", width=200.0, height=100.0),
            "b": _make_note("b", width=200.0, height=100.0),
        },
    )

    await rearrange_created_notes(store, "graph-1", ["a", "b"])

    positions = {nid: _patched_position(store, nid) for nid in ["a", "b"]}
    assert positions["a"]["x"] == pytest.approx(100.0)  # anchor min_x
    assert positions["a"]["y"] == pytest.approx(250.0 + DEFAULT_NOTE_GAP)
    assert positions["b"]["y"] == pytest.approx(positions["a"]["y"])  # same row


@pytest.mark.asyncio
async def test_rearrange_anchors_below_folder_content_when_scoped() -> None:
    """Inside a folder, the anchor must use folder content, not the root-level board.

    Without root_id propagation, _board_tail_origin would query the top-level board
    and place the new tiles relative to root-level nodes — far from where the user
    actually is. With root_id, only folder-1's existing notes contribute.
    """
    from topix.agents.notes.service import DEFAULT_NOTE_GAP

    folder_existing = _make_note(
        "folder-existing", x=200.0, y=300.0, width=200.0, height=100.0,
    )
    folder_existing.parent_id = "folder-1"
    root_existing = _make_note(
        "root-existing", x=10.0, y=5000.0, width=200.0, height=100.0,
    )
    new_a = _make_note("new-a", width=200.0, height=100.0)
    new_a.parent_id = "folder-1"
    new_b = _make_note("new-b", width=200.0, height=100.0)
    new_b.parent_id = "folder-1"

    store = _FakeGraphStore(
        notes={
            "folder-existing": folder_existing,
            "root-existing": root_existing,
            "new-a": new_a,
            "new-b": new_b,
        },
    )

    await rearrange_created_notes(
        store, "graph-1", ["new-a", "new-b"], root_id="folder-1",
    )

    positions = {nid: _patched_position(store, nid) for nid in ["new-a", "new-b"]}
    # Anchored below folder-existing (bottom edge at 400), not below root-existing (5000+).
    assert positions["new-a"]["x"] == pytest.approx(200.0)
    assert positions["new-a"]["y"] == pytest.approx(400.0 + DEFAULT_NOTE_GAP)
    assert positions["new-b"]["y"] == pytest.approx(positions["new-a"]["y"])


# -----------------------------
# Anchor (old node) handling
# -----------------------------

@pytest.mark.asyncio
async def test_rearrange_pins_layout_to_old_anchor_position() -> None:
    """When a created link touches an old node, the layout pins to its real position."""
    old_anchor = _make_note("old", x=2000.0, y=1000.0, width=200.0, height=100.0)
    new_a = _make_note("new-a", width=200.0, height=100.0)
    new_b = _make_note("new-b", width=200.0, height=100.0)
    link_oa = Link(source="old", target="new-a", graph_uid="graph-1")
    link_ob = Link(source="old", target="new-b", graph_uid="graph-1")
    store = _FakeGraphStore(
        notes={"old": old_anchor, "new-a": new_a, "new-b": new_b},
        links=[link_oa, link_ob],
    )

    moved = await rearrange_created_notes(
        store, "graph-1", ["new-a", "new-b"],
        created_link_ids=[link_oa.id, link_ob.id],
    )

    assert set(moved) == {"new-a", "new-b"}
    # The anchor must never appear in patches.
    assert "old" not in {nid for nid, _ in store.patches}
    # New nodes land to the right of the anchor (LR layout).
    by_id = {nid: _patched_position(store, nid) for nid in moved}
    assert by_id["new-a"]["x"] > 2000.0
    assert by_id["new-b"]["x"] > 2000.0


@dataclass
class _FakeAgentBridge:
    """Records bridge.patch_note calls so the rearrange→bridge path can assert."""

    notes: dict[str, Note] = field(default_factory=dict)
    calls: list[dict] = field(default_factory=list)

    async def patch_note(
        self, *, board_id: str, node_id: str, data: dict, user_uid: str | None,
    ) -> Note | None:
        """Record the call and apply the position patch in-memory."""
        self.calls.append({"node_id": node_id, "data": data, "board_id": board_id})
        note = self.notes.get(node_id)
        if note is None:
            return None
        position = data.get("properties", {}).get("node_position", {}).get("position")
        if position is not None:
            note.properties.node_position = PositionProperty(
                position=PositionProperty.Position(x=position["x"], y=position["y"]),
            )
        return note


@pytest.mark.asyncio
async def test_rearrange_routes_through_agent_bridge_when_supplied() -> None:
    """When `agent_bridge` is set, position patches flow through it.

    Routing through the bridge is what makes live collab peers see the
    post-turn layout — `graph_store.patch_note` alone persists but does
    not broadcast.
    """
    note_a = _make_note("a", width=200.0, height=100.0)
    note_b = _make_note("b", width=200.0, height=100.0)
    store = _FakeGraphStore(notes={"a": note_a, "b": note_b})
    bridge = _FakeAgentBridge(notes={"a": note_a, "b": note_b})

    moved = await rearrange_created_notes(
        store, "graph-1", ["a", "b"], agent_bridge=bridge,
    )

    # All patches went through the bridge — graph_store was NOT touched.
    assert set(moved) == {"a", "b"}
    assert store.patches == []
    assert {call["node_id"] for call in bridge.calls} == {"a", "b"}
    # board_id is propagated for the peer-op routing inside the bridge.
    assert {call["board_id"] for call in bridge.calls} == {"graph-1"}


@pytest.mark.asyncio
async def test_rearrange_falls_back_to_graph_store_when_bridge_missing() -> None:
    """No bridge supplied → patches go to `graph_store` (legacy / CLI / tests)."""
    note_a = _make_note("a", width=200.0, height=100.0)
    note_b = _make_note("b", width=200.0, height=100.0)
    store = _FakeGraphStore(notes={"a": note_a, "b": note_b})

    moved = await rearrange_created_notes(store, "graph-1", ["a", "b"])

    assert set(moved) == {"a", "b"}
    assert {nid for nid, _ in store.patches} == {"a", "b"}


@pytest.mark.asyncio
async def test_rearrange_does_not_move_anchor_node() -> None:
    """The anchor's stored position is unchanged after rearrange runs."""
    old_anchor = _make_note("old", x=2000.0, y=1000.0)
    new_a = _make_note("new-a")
    new_b = _make_note("new-b")
    link = Link(source="old", target="new-a", graph_uid="graph-1")
    store = _FakeGraphStore(
        notes={"old": old_anchor, "new-a": new_a, "new-b": new_b},
        links=[link],
    )

    await rearrange_created_notes(
        store, "graph-1", ["new-a", "new-b"],
        created_link_ids=[link.id],
    )

    # Anchor's persisted position stays put.
    assert old_anchor.properties.node_position.position.x == 2000.0
    assert old_anchor.properties.node_position.position.y == 1000.0
