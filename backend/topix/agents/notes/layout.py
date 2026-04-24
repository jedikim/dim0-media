"""Post-turn layout for notes the agent just created.

The agent writes notes one-by-one via `write_note` and optionally connects them
with `link_notes`. Each individual write lands at the backend's stacked default
position, which is fine for single-note turns but produces a column for multi-
note ones. After the planner's turn ends, :func:`rearrange_created_notes` runs
once over the newly-created ids, groups them by connected component, lays each
component out internally (tree layout if tree-shaped, horizontal fallback
otherwise), then flex-wraps the component bounding boxes into rows. Only notes
in the caller-supplied id list are touched, so anything the user may have moved
during streaming is preserved.
"""

from __future__ import annotations

from collections import defaultdict

from topix.agents.notes.service import DEFAULT_NOTE_GAP
from topix.datatypes.note.link import Link
from topix.datatypes.note.note import Note
from topix.datatypes.property import PositionProperty
from topix.store.graph import GraphStore

# Defaults tuned to match the frontend dagre feel used by the REST mindmap flow.
RANK_SEP = 150.0
NODE_SEP = 75.0
H_GAP = 80.0
V_GAP = 120.0
MAX_ROW_WIDTH = 3500.0


def _connected_components(
    note_ids: list[str],
    links: list[Link],
) -> list[list[str]]:
    """Group ids into connected components via union-find, preserving input order."""
    id_set = set(note_ids)
    parent = {nid: nid for nid in note_ids}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for link in links:
        if link.source in id_set and link.target in id_set:
            union(link.source, link.target)

    buckets: dict[str, list[str]] = defaultdict(list)
    for nid in note_ids:
        buckets[find(nid)].append(nid)

    ordered_roots: list[str] = []
    for nid in note_ids:
        root = find(nid)
        if root not in ordered_roots:
            ordered_roots.append(root)
    return [buckets[r] for r in ordered_roots]


def _classify_tree(
    nodes: list[str],
    links: list[Link],
) -> tuple[bool, str | None, dict[str, list[str]]]:
    """Return (is_tree, root_id, children_of) for a connected component.

    A component is a tree when every non-root node has exactly one parent, there
    is a single root (in-degree 0), and the parent->child relation reaches every
    node without cycles.
    """
    id_set = set(nodes)
    children: dict[str, list[str]] = defaultdict(list)
    parent_of: dict[str, str] = {}
    for link in links:
        if link.source in id_set and link.target in id_set:
            if link.target in parent_of:
                return False, None, {}
            parent_of[link.target] = link.source
            children[link.source].append(link.target)

    roots = [nid for nid in nodes if nid not in parent_of]
    if len(roots) != 1:
        return False, None, {}

    root = roots[0]
    seen = {root}
    stack = [root]
    while stack:
        cur = stack.pop()
        for child in children.get(cur, []):
            if child in seen:
                return False, None, {}
            seen.add(child)
            stack.append(child)

    if seen != id_set:
        return False, None, {}

    return True, root, dict(children)


def _layout_tree_lr(
    root: str,
    children: dict[str, list[str]],
    size_of: dict[str, tuple[float, float]],
    rank_sep: float = RANK_SEP,
    node_sep: float = NODE_SEP,
) -> dict[str, tuple[float, float]]:
    """Place tree nodes left-to-right; each subtree gets a vertical slot, centered on parent."""
    subtree_height: dict[str, float] = {}

    def measure(nid: str) -> float:
        own_h = size_of[nid][1]
        kids = children.get(nid, [])
        if not kids:
            subtree_height[nid] = own_h
            return own_h
        total = sum(measure(k) for k in kids) + node_sep * (len(kids) - 1)
        h = max(own_h, total)
        subtree_height[nid] = h
        return h

    measure(root)

    positions: dict[str, tuple[float, float]] = {}

    def place(nid: str, x: float, y_top: float) -> None:
        own_w, own_h = size_of[nid]
        node_y = y_top + (subtree_height[nid] - own_h) / 2
        positions[nid] = (x, node_y)
        kids = children.get(nid, [])
        if not kids:
            return
        child_x = x + own_w + rank_sep
        cursor_y = y_top
        for k in kids:
            place(k, child_x, cursor_y)
            cursor_y += subtree_height[k] + node_sep

    place(root, 0.0, 0.0)
    return positions


def _layout_row(
    nodes: list[str],
    size_of: dict[str, tuple[float, float]],
    h_gap: float = H_GAP,
) -> dict[str, tuple[float, float]]:
    """Fallback horizontal row for DAG components we cannot confidently tree-layout."""
    positions: dict[str, tuple[float, float]] = {}
    cursor_x = 0.0
    for nid in nodes:
        positions[nid] = (cursor_x, 0.0)
        cursor_x += size_of[nid][0] + h_gap
    return positions


def _component_bounds(
    layout: dict[str, tuple[float, float]],
    size_of: dict[str, tuple[float, float]],
) -> tuple[dict[str, tuple[float, float]], float, float]:
    """Normalize a component layout to origin (0, 0) and return its outer width/height."""
    if not layout:
        return {}, 0.0, 0.0
    min_x = min(x for x, _ in layout.values())
    min_y = min(y for _, y in layout.values())
    max_x = max(x + size_of[nid][0] for nid, (x, _) in layout.items())
    max_y = max(y + size_of[nid][1] for nid, (_, y) in layout.items())
    normalized = {nid: (x - min_x, y - min_y) for nid, (x, y) in layout.items()}
    return normalized, max_x - min_x, max_y - min_y


async def _board_tail_anchor(
    graph_store: GraphStore,
    graph_uid: str,
    exclude_ids: set[str],
) -> tuple[float, float]:
    """Return an origin just below existing board content, ignoring the newly-created ids."""
    graph = await graph_store.get_graph(graph_uid)
    if graph is None:
        return 0.0, 0.0

    siblings = [
        n for n in graph.nodes
        if n.deleted_at is None
        and n.id not in exclude_ids
        and n.properties.node_position.position is not None
    ]
    if not siblings:
        return 0.0, 0.0

    min_x = min(n.properties.node_position.position.x for n in siblings)
    max_y = max(
        n.properties.node_position.position.y
        + (n.properties.node_size.size.height if n.properties.node_size.size else 0.0)
        for n in siblings
    )
    return min_x, max_y + DEFAULT_NOTE_GAP


def _size_of(note: Note) -> tuple[float, float]:
    size = note.properties.node_size.size
    if size is None:
        return 0.0, 0.0
    return size.width, size.height


async def rearrange_created_notes(  # noqa: C901
    graph_store: GraphStore,
    graph_uid: str,
    created_ids: list[str],
    created_link_ids: list[str] | None = None,
    max_row_width: float = MAX_ROW_WIDTH,
    h_gap: float = H_GAP,
    v_gap: float = V_GAP,
) -> list[str]:
    """Flex-wrap newly-created notes into rows of component tiles.

    Args:
        graph_store: Store used to read notes/links and patch positions.
        graph_uid: Board scope. Notes or links belonging to a different board are ignored.
        created_ids: Ids of notes created in the current turn. Only these are moved.
        created_link_ids: Ids of links created in the current turn. Fetched directly by id
            (consistent) rather than via scroll (eventually consistent) so components form
            correctly immediately after writes.
        max_row_width: Width budget for a row before wrapping to the next.
        h_gap: Horizontal gap between component tiles in the same row.
        v_gap: Vertical gap between rows.

    Returns:
        The ids that were actually repositioned. An empty list means nothing was done
        (for example fewer than 2 created notes, or none survived the scope filter).

    """
    if len(created_ids) < 2:
        return []

    seen: set[str] = set()
    ordered_ids: list[str] = []
    for nid in created_ids:
        if nid in seen:
            continue
        seen.add(nid)
        ordered_ids.append(nid)

    fetched = await graph_store.get_nodes(ordered_ids)
    notes_by_id: dict[str, Note] = {
        n.id: n for n in fetched
        if n.graph_uid == graph_uid and n.deleted_at is None
    }
    scoped_ids = [nid for nid in ordered_ids if nid in notes_by_id]
    if len(scoped_ids) < 2:
        return []

    scoped_set = set(scoped_ids)
    relevant_links: list[Link] = []
    if created_link_ids:
        seen_link_ids: set[str] = set()
        unique_link_ids = [
            lid for lid in created_link_ids
            if not (lid in seen_link_ids or seen_link_ids.add(lid))
        ]
        fetched_links = await graph_store.get_links(unique_link_ids)
        for link in fetched_links:
            if link.graph_uid != graph_uid:
                continue
            if link.deleted_at is not None:
                continue
            if link.source in scoped_set and link.target in scoped_set:
                relevant_links.append(link)

    size_of = {nid: _size_of(notes_by_id[nid]) for nid in scoped_ids}

    components = _connected_components(scoped_ids, relevant_links)

    component_layouts: list[dict[str, tuple[float, float]]] = []
    component_bounds: list[tuple[float, float]] = []

    for comp in components:
        if len(comp) == 1:
            nid = comp[0]
            component_layouts.append({nid: (0.0, 0.0)})
            component_bounds.append(size_of[nid])
            continue

        is_tree, root, children = _classify_tree(comp, relevant_links)
        if is_tree and root is not None:
            raw = _layout_tree_lr(root, children, size_of)
        else:
            raw = _layout_row(comp, size_of, h_gap=h_gap)

        normalized, width, height = _component_bounds(raw, size_of)
        component_layouts.append(normalized)
        component_bounds.append((width, height))

    origin_x, origin_y = await _board_tail_anchor(graph_store, graph_uid, scoped_set)

    final_positions: dict[str, tuple[float, float]] = {}
    cursor_x = origin_x
    cursor_y = origin_y
    row_width = 0.0
    row_max_h = 0.0

    for comp_local, (comp_w, comp_h) in zip(component_layouts, component_bounds):
        if row_width > 0.0 and row_width + comp_w > max_row_width:
            cursor_y += row_max_h + v_gap
            cursor_x = origin_x
            row_width = 0.0
            row_max_h = 0.0
        for nid, (lx, ly) in comp_local.items():
            final_positions[nid] = (cursor_x + lx, cursor_y + ly)
        cursor_x += comp_w + h_gap
        row_width += comp_w + h_gap
        if comp_h > row_max_h:
            row_max_h = comp_h

    moved: list[str] = []
    for nid, (x, y) in final_positions.items():
        patch = {
            "properties": {
                "node_position": PositionProperty(
                    position=PositionProperty.Position(x=x, y=y),
                ).model_dump()
            }
        }
        updated = await graph_store.patch_note(nid, patch)
        if updated is not None:
            moved.append(nid)
    return moved
