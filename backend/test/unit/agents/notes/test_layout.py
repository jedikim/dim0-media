"""Tests for the post-turn flex-wrap / tree rearrange pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from topix.agents.notes.layout import (
    H_GAP,
    NODE_SEP,
    RANK_SEP,
    V_GAP,
    _classify_tree,
    _connected_components,
    _layout_tree_lr,
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
        scoped_nodes = [n for n in self.notes.values() if n.graph_uid == graph_uid]
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


# -----------------------------
# Component + tree helpers
# -----------------------------

def test_connected_components_preserves_input_order() -> None:
    """Components should be returned in the order their first member appears in the input."""
    links = [Link(source="a", target="b", graph_uid="g"), Link(source="c", target="d", graph_uid="g")]
    comps = _connected_components(["a", "b", "c", "d", "e"], links)

    assert comps == [["a", "b"], ["c", "d"], ["e"]]


def test_classify_tree_accepts_simple_tree() -> None:
    """A component with a single root and no multi-parenting is recognized as a tree."""
    links = [
        Link(source="root", target="a", graph_uid="g"),
        Link(source="root", target="b", graph_uid="g"),
        Link(source="a", target="a1", graph_uid="g"),
    ]

    is_tree, root, children = _classify_tree(["root", "a", "b", "a1"], links)

    assert is_tree is True
    assert root == "root"
    assert set(children["root"]) == {"a", "b"}
    assert children["a"] == ["a1"]


def test_classify_tree_rejects_multi_parent_dag() -> None:
    """A node with two incoming edges is not a tree."""
    links = [
        Link(source="a", target="c", graph_uid="g"),
        Link(source="b", target="c", graph_uid="g"),
    ]

    is_tree, *_ = _classify_tree(["a", "b", "c"], links)

    assert is_tree is False


def test_classify_tree_rejects_cycle() -> None:
    """A cycle in the component disqualifies the tree classifier."""
    links = [
        Link(source="a", target="b", graph_uid="g"),
        Link(source="b", target="c", graph_uid="g"),
        Link(source="c", target="a", graph_uid="g"),
    ]

    is_tree, *_ = _classify_tree(["a", "b", "c"], links)

    assert is_tree is False


def test_layout_tree_lr_centers_children_around_parent() -> None:
    """A parent with two same-sized children is placed at the subtree's vertical center."""
    children = {"root": ["a", "b"]}
    size_of = {"root": (200.0, 100.0), "a": (200.0, 100.0), "b": (200.0, 100.0)}

    positions = _layout_tree_lr("root", children, size_of, rank_sep=100.0, node_sep=50.0)

    # root spans a subtree height of 100 + 50 + 100 = 250; its center sits at y = 75.
    assert positions["root"] == (0.0, 75.0)
    # children share the same x column, start just to the right of root.
    assert positions["a"][0] == 300.0
    assert positions["b"][0] == 300.0
    # stacked by node_sep, first child at y=0, second at y=150.
    assert positions["a"][1] == 0.0
    assert positions["b"][1] == 150.0


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
    # Eight 1000x100 notes with h_gap=80 and max_row_width=3500 -> 3 per row, then wrap.
    note_ids = [f"n{i}" for i in range(8)]
    store = _FakeGraphStore(
        notes={nid: _make_note(nid, width=1000.0, height=100.0) for nid in note_ids},
    )

    moved = await rearrange_created_notes(
        store, "graph-1", note_ids, max_row_width=3500.0, h_gap=80.0, v_gap=40.0,
    )

    assert set(moved) == set(note_ids)
    by_id = {nid: data["properties"]["node_position"]["position"] for nid, data in store.patches}
    # Row 1: n0 at x=0, n1 at x=1080, n2 at x=2160, all y=0
    assert by_id["n0"] == {"x": 0.0, "y": 0.0}
    assert by_id["n1"] == {"x": 1080.0, "y": 0.0}
    assert by_id["n2"] == {"x": 2160.0, "y": 0.0}
    # n3 would reach x=3240; adding comp_w=1000 -> row_width 4320 > 3500, so n3 wraps to a new row.
    assert by_id["n3"]["x"] == 0.0
    assert by_id["n3"]["y"] == pytest.approx(140.0)  # 100 row height + 40 v_gap


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
    # Position of the untouched note is unchanged.
    assert untouched.properties.node_position.position.x == 5000.0
    assert untouched.properties.node_position.position.y == 5000.0


@pytest.mark.asyncio
async def test_rearrange_layouts_tree_component_as_one_tile() -> None:
    """A tree component is laid out internally, then treated as one tile for flex-wrap."""
    # Three-node tree with two singletons; expect the tree to occupy one tile to the left,
    # singletons to flex-wrap after it along the same row.
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
        max_row_width=10000.0, h_gap=H_GAP, v_gap=V_GAP,
    )

    assert set(moved) == {"root", "a", "b", "solo1", "solo2"}
    by_id = {nid: data["properties"]["node_position"]["position"] for nid, data in store.patches}
    # Tree tile: width = root(200) + rank_sep(150) + child(200) = 550.
    # Height: 2 children of 100 each + node_sep(75) = 275.
    assert by_id["root"]["x"] == 0.0
    assert by_id["a"]["x"] == 200.0 + RANK_SEP
    assert by_id["b"]["x"] == 200.0 + RANK_SEP
    # Children stacked by node_sep at y=0 and y=100+75=175.
    child_ys = sorted([by_id["a"]["y"], by_id["b"]["y"]])
    assert child_ys == [0.0, 100.0 + NODE_SEP]
    # Singletons start after the tree: tree bbox width 550 + h_gap.
    assert by_id["solo1"]["x"] == 550.0 + H_GAP


@pytest.mark.asyncio
async def test_rearrange_falls_back_to_horizontal_row_for_dag_component() -> None:
    """Multi-parent components use the simple horizontal-row fallback for now."""
    # a and b both point to c -> multi-parent DAG, not a tree.
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

    by_id = {nid: data["properties"]["node_position"]["position"] for nid, data in store.patches}
    ys = {by_id["a"]["y"], by_id["b"]["y"], by_id["c"]["y"]}
    assert ys == {0.0}  # single horizontal row
    xs = sorted([by_id["a"]["x"], by_id["b"]["x"], by_id["c"]["x"]])
    assert xs[1] - xs[0] == pytest.approx(200.0 + H_GAP)
    assert xs[2] - xs[1] == pytest.approx(200.0 + H_GAP)


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
        links=[existing_link],  # present on the board, but NOT passed as created
    )

    await rearrange_created_notes(store, "graph-1", ["a", "b"])  # no created_link_ids

    by_id = {nid: data["properties"]["node_position"]["position"] for nid, data in store.patches}
    # Two singletons side by side, not a 2-node connected component.
    assert by_id["a"]["y"] == by_id["b"]["y"]
    assert abs(by_id["a"]["x"] - by_id["b"]["x"]) == pytest.approx(200.0 + H_GAP)


@pytest.mark.asyncio
async def test_rearrange_anchors_below_existing_board_content() -> None:
    """New tiles must land below the existing board's bottom edge, not on top of it."""
    # Existing content bottom edge at y=250 (pos y=150, height=100); created notes should
    # start at y > 250 + DEFAULT_NOTE_GAP.
    from topix.agents.notes.service import DEFAULT_NOTE_GAP

    store = _FakeGraphStore(
        notes={
            "existing": _make_note("existing", x=100.0, y=150.0, width=200.0, height=100.0),
            "a": _make_note("a", width=200.0, height=100.0),
            "b": _make_note("b", width=200.0, height=100.0),
        },
    )

    await rearrange_created_notes(store, "graph-1", ["a", "b"])

    positions = {nid: data["properties"]["node_position"]["position"] for nid, data in store.patches}
    assert positions["a"]["x"] == pytest.approx(100.0)  # anchor min_x
    assert positions["a"]["y"] == pytest.approx(250.0 + DEFAULT_NOTE_GAP)
    assert positions["b"]["y"] == pytest.approx(positions["a"]["y"])  # same row
