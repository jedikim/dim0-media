"""Tests for the primitive board-scoped note tools."""

from __future__ import annotations

import asyncio
import json

from unittest.mock import ANY, AsyncMock

import pytest

from agents.tool_context import ToolContext

from topix.agents.datatypes.context import Context
from topix.agents.notes.service import build_note, get_default_note_size
from topix.agents.notes.tools import (
    create_edit_note_tool,
    create_get_note_tool,
    create_link_notes_tool,
    create_write_note_tool,
)
from topix.datatypes.note.note import Note
from topix.datatypes.note.style import NodeType
from topix.datatypes.resource import RichText


def _make_tool_ctx(tool_name: str = "test_tool") -> ToolContext[Context]:
    """Build a ToolContext stub for invoking tools directly in unit tests."""
    return ToolContext(
        context=Context(),
        tool_name=tool_name,
        tool_call_id="test-call-id",
        tool_arguments="{}",
    )


class DummyGraphStore:
    """Minimal graph-store stub for note tool tests."""

    def __init__(self):
        """Initialize async methods used by note tools."""
        self.add_notes = AsyncMock()
        self.add_links = AsyncMock()
        self.get_graph = AsyncMock(return_value=type("Graph", (), {"nodes": []})())
        self.get_nodes = AsyncMock(return_value=[])
        self.patch_note = AsyncMock()
        self._note_locks: dict[str, asyncio.Lock] = {}

    def note_lock(self, note_id: str) -> asyncio.Lock:
        """Mirror GraphStore.note_lock so tools can serialize same-note edits in tests."""
        return self._note_locks.setdefault(note_id, asyncio.Lock())


@pytest.mark.asyncio
async def test_build_note_sheet_keeps_default_size() -> None:
    """Sheets are long-form rich-text docs: kept at the full default size, not content-fit."""
    graph_store = DummyGraphStore()

    note = await build_note(
        graph_store=graph_store,
        graph_uid="graph-1",
        content="hello",
        label="Sheet note",
        note_type=NodeType.SHEET,
        parent_id=None,
    )

    assert note.graph_uid == "graph-1"
    assert note.style.type == NodeType.SHEET
    # Sheet is exempt from content sizing — it keeps its full default footprint
    # (a long doc shouldn't auto-grow into a giant card; it scrolls instead).
    default_w, default_h = get_default_note_size(NodeType.SHEET)
    assert note.properties.node_size.size.width == default_w
    assert note.properties.node_size.size.height == default_h
    assert note.properties.node_position.position.x == 0
    assert note.properties.node_position.position.y == 0


@pytest.mark.asyncio
async def test_build_note_code_sandbox_keeps_default_size() -> None:
    """Code sandboxes are scrolling surfaces: kept at the full default size, not content-fit.

    Same rationale as sheets — code can be arbitrarily long (whole programs),
    so fitting the box to content would create giant cards. The default 560x360
    rectangle is sized for ~75 chars/line at typical monospace, close to the
    80-char code convention. Long snippets scroll inside the box.
    """
    graph_store = DummyGraphStore()

    note = await build_note(
        graph_store=graph_store,
        graph_uid="graph-1",
        content="print('hello, world')\n",
        label="Snippet",
        note_type=NodeType.CODE_SANDBOX,
        parent_id=None,
    )

    assert note.style.type == NodeType.CODE_SANDBOX
    default_w, default_h = get_default_note_size(NodeType.CODE_SANDBOX)
    assert note.properties.node_size.size.width == default_w
    assert note.properties.node_size.size.height == default_h


@pytest.mark.asyncio
async def test_build_widget_note_uses_widget_defaults() -> None:
    """Widget notes should use dedicated widget defaults."""
    graph_store = DummyGraphStore()

    note = await build_note(
        graph_store=graph_store,
        graph_uid="graph-1",
        content="<div>widget</div>",
        label="Widget note",
        note_type=NodeType.WIDGET,
        parent_id=None,
    )

    assert note.style.type == NodeType.WIDGET
    assert note.properties.node_size.size.width == 800
    assert note.properties.node_size.size.height == 500


@pytest.mark.asyncio
async def test_build_inscribed_shapes_stay_square() -> None:
    """Ellipse and diamond families fit content but keep a square-ish aspect."""
    graph_store = DummyGraphStore()

    ellipse_note = await build_note(
        graph_store=graph_store,
        graph_uid="graph-1",
        content="Ellipse",
        label="Ellipse",
        note_type=NodeType.ELLIPSE,
        parent_id=None,
    )
    diamond_note = await build_note(
        graph_store=graph_store,
        graph_uid="graph-1",
        content="Diamond",
        label="Diamond",
        note_type=NodeType.DIAMOND,
        parent_id=None,
    )

    ellipse_size = ellipse_note.properties.node_size.size
    diamond_size = diamond_note.properties.node_size.size
    # Content-fit shrinks them, but the min-aspect floor keeps height >= width
    # so a short label doesn't collapse into a sliver.
    assert ellipse_size.height >= ellipse_size.width
    assert diamond_size.height >= diamond_size.width
    # And never grow past the type's default footprint.
    assert ellipse_size.width <= 320
    assert diamond_size.width <= 340


@pytest.mark.asyncio
async def test_write_note_tool_creates_note_in_root_scope_by_default() -> None:
    """Write note should create a note in the current root folder when note_id is omitted."""
    graph_store = DummyGraphStore()
    tool = create_write_note_tool(graph_store, "graph-1", root_id="folder-1")

    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"content": "New note content", "label": "New note"}),
    )

    assert result.type == "write_note"
    assert result.action == "created"
    assert result.graph_uid == "graph-1"
    assert result.parent_id == "folder-1"
    assert result.note_type == NodeType.RECTANGLE
    graph_store.add_notes.assert_awaited_once()
    created_note = graph_store.add_notes.await_args.args[0][0]
    assert created_note.graph_uid == "graph-1"
    assert created_note.parent_id == "folder-1"
    assert created_note.content is not None
    assert created_note.content.markdown == "New note content"
    # Width is content-fit, never wider than the type's default footprint.
    assert 0 < created_note.properties.node_size.size.width <= get_default_note_size(NodeType.RECTANGLE)[0]


@pytest.mark.asyncio
async def test_write_note_tool_rewrites_existing_note_and_seeds_size_when_too_small() -> None:
    """Converting a too-small note to sheet seeds the default sheet size for readability."""
    graph_store = DummyGraphStore()
    existing_note = Note(
        id="note-1",
        graph_uid="graph-1",
        label=RichText(markdown="Before"),
        content=RichText(markdown="Old"),
    )
    # Default node_size is 300x100; height is below the sheet min so it should be upgraded.
    updated_note = existing_note.model_copy(deep=True)
    updated_note.label = RichText(markdown="After")
    updated_note.content = RichText(markdown="New")
    updated_note.style.type = NodeType.SHEET

    graph_store.get_nodes.return_value = [existing_note]
    graph_store.patch_note.return_value = updated_note

    tool = create_write_note_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps(
            {
                "note_id": "note-1",
                "content": "New",
                "label": "After",
                "note_type": "sheet",
            }
        ),
    )

    assert result.type == "write_note"
    assert result.action == "rewritten"
    assert result.note_id == "note-1"
    assert result.note_type == NodeType.SHEET
    graph_store.patch_note.assert_awaited_once_with(
        "note-1",
        {
            "label": {"markdown": "After"},
            "content": {"markdown": "New"},
            "style": {"type": NodeType.SHEET},
            "properties": {
                "node_size": {
                    "id": ANY,
                    "type": "size",
                    "size": {
                        "width": 440.0,
                        "height": 440.0,
                    },
                },
            },
        },
    )


@pytest.mark.asyncio
async def test_write_note_tool_preserves_size_when_existing_already_sheet_sized() -> None:
    """Converting to sheet must not overwrite an existing size that already meets the sheet min."""
    graph_store = DummyGraphStore()
    existing_note = Note(
        id="note-1",
        graph_uid="graph-1",
        label=RichText(markdown="Before"),
        content=RichText(markdown="Old"),
    )
    existing_note.properties.node_size.size.width = 480
    existing_note.properties.node_size.size.height = 320

    updated_note = existing_note.model_copy(deep=True)
    updated_note.style.type = NodeType.SHEET

    graph_store.get_nodes.return_value = [existing_note]
    graph_store.patch_note.return_value = updated_note

    tool = create_write_note_tool(graph_store, "graph-1")
    await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps(
            {
                "note_id": "note-1",
                "content": "New",
                "note_type": "sheet",
            }
        ),
    )

    graph_store.patch_note.assert_awaited_once_with(
        "note-1",
        {
            "label": None,
            "content": {"markdown": "New"},
            "style": {"type": NodeType.SHEET},
        },
    )


@pytest.mark.asyncio
async def test_edit_note_tool_updates_only_requested_field() -> None:
    """Edit note should patch only the targeted text field."""
    graph_store = DummyGraphStore()
    existing_note = Note(
        id="note-1",
        graph_uid="graph-1",
        label=RichText(markdown="Before"),
        content=RichText(markdown="Old"),
    )
    updated_note = existing_note.model_copy(deep=True)
    updated_note.label = RichText(markdown="After")

    graph_store.get_nodes.return_value = [existing_note]
    graph_store.patch_note.return_value = updated_note

    tool = create_edit_note_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"note_id": "note-1", "field": "label", "old": "Before", "new": "After"}),
    )

    assert result.type == "edit_note"
    assert result.note_id == "note-1"
    assert result.note_type == NodeType.RECTANGLE
    graph_store.patch_note.assert_awaited_once_with(
        "note-1",
        {
            "label": {"markdown": "After"},
        },
    )


@pytest.mark.asyncio
async def test_edit_note_tool_replaces_substring_within_larger_field() -> None:
    """Edit note should replace a unique substring without touching surrounding text."""
    graph_store = DummyGraphStore()
    existing_note = Note(
        id="note-1",
        graph_uid="graph-1",
        content=RichText(markdown="alpha beta gamma"),
    )
    updated_note = existing_note.model_copy(deep=True)
    updated_note.content = RichText(markdown="alpha BETA gamma")

    graph_store.get_nodes.return_value = [existing_note]
    graph_store.patch_note.return_value = updated_note

    tool = create_edit_note_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"note_id": "note-1", "field": "content", "old": "beta", "new": "BETA"}),
    )

    assert result.type == "edit_note"
    graph_store.patch_note.assert_awaited_once_with(
        "note-1",
        {"content": {"markdown": "alpha BETA gamma"}},
    )


@pytest.mark.asyncio
async def test_write_note_tool_schema_hides_parent_scope_args() -> None:
    """Write note tool should not expose internal board-scope args."""
    tool = create_write_note_tool(DummyGraphStore(), "graph-1", root_id="folder-1")

    assert "parent_id" not in tool.params_json_schema["properties"]
    assert "note_id" in tool.params_json_schema["properties"]
    assert "content" in tool.params_json_schema["properties"]
    assert "label" in tool.params_json_schema["properties"]
    assert "content" in tool.params_json_schema.get("required", [])


@pytest.mark.asyncio
async def test_edit_note_tool_schema_hides_parent_scope_args() -> None:
    """Edit note tool should not expose internal board-scope args."""
    tool = create_edit_note_tool(DummyGraphStore(), "graph-1")

    assert "parent_id" not in tool.params_json_schema["properties"]
    assert "field" in tool.params_json_schema["properties"]
    assert "old" in tool.params_json_schema["properties"]
    assert "new" in tool.params_json_schema["properties"]
    assert "replace_all" in tool.params_json_schema["properties"]


@pytest.mark.asyncio
async def test_edit_note_tool_rejects_cross_board_notes() -> None:
    """Edit note should fail when the note does not belong to the scoped board."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [
        Note(
            id="note-1",
            graph_uid="graph-2",
            content=RichText(markdown="anything"),
        )
    ]

    tool = create_edit_note_tool(graph_store, "graph-1")

    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"note_id": "note-1", "field": "content", "old": "anything", "new": "Nope"}),
    )

    assert isinstance(result, str)
    assert "does not belong to the current board scope" in result


@pytest.mark.asyncio
async def test_edit_note_tool_rejects_old_not_found() -> None:
    """Edit note should fail when the anchor substring is absent from the field."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [
        Note(
            id="note-1",
            graph_uid="graph-1",
            content=RichText(markdown="Current"),
        )
    ]

    tool = create_edit_note_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"note_id": "note-1", "field": "content", "old": "Old", "new": "After"}),
    )

    assert isinstance(result, str)
    assert "not found" in result


@pytest.mark.asyncio
async def test_edit_note_tool_rejects_non_unique_old_without_replace_all() -> None:
    """Edit note should fail when the anchor occurs more than once and replace_all is off."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [
        Note(
            id="note-1",
            graph_uid="graph-1",
            content=RichText(markdown="hello hello"),
        )
    ]

    tool = create_edit_note_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"note_id": "note-1", "field": "content", "old": "hello", "new": "world"}),
    )

    assert isinstance(result, str)
    assert "occurs 2 times" in result
    graph_store.patch_note.assert_not_awaited()


@pytest.mark.asyncio
async def test_edit_note_tool_replaces_all_when_flag_is_set() -> None:
    """Edit note should replace every occurrence when replace_all is true."""
    graph_store = DummyGraphStore()
    existing_note = Note(
        id="note-1",
        graph_uid="graph-1",
        content=RichText(markdown="hello hello"),
    )
    updated_note = existing_note.model_copy(deep=True)
    updated_note.content = RichText(markdown="world world")

    graph_store.get_nodes.return_value = [existing_note]
    graph_store.patch_note.return_value = updated_note

    tool = create_edit_note_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps(
            {
                "note_id": "note-1",
                "field": "content",
                "old": "hello",
                "new": "world",
                "replace_all": True,
            }
        ),
    )

    assert result.type == "edit_note"
    graph_store.patch_note.assert_awaited_once_with(
        "note-1",
        {"content": {"markdown": "world world"}},
    )


@pytest.mark.asyncio
async def test_edit_note_tool_rejects_empty_old() -> None:
    """Edit note should reject an empty anchor up front, never reaching the store."""
    graph_store = DummyGraphStore()
    tool = create_edit_note_tool(graph_store, "graph-1")

    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"note_id": "note-1", "field": "content", "old": "", "new": "x"}),
    )

    assert isinstance(result, str)
    assert "Empty old" in result
    graph_store.get_nodes.assert_not_awaited()
    graph_store.patch_note.assert_not_awaited()


@pytest.mark.asyncio
async def test_get_note_tool_returns_current_note_metadata_and_content() -> None:
    """Get note should return the current label, content, type, and parent metadata."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [
        Note(
            id="note-1",
            graph_uid="graph-1",
            parent_id="folder-1",
            label=RichText(markdown="Roadmap"),
            content=RichText(markdown="Current plan"),
            style={"type": NodeType.SHEET},
        )
    ]

    tool = create_get_note_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"note_id": "note-1"}),
    )

    assert result.type == "get_note"
    assert result.note_id == "note-1"
    assert result.graph_uid == "graph-1"
    assert result.parent_id == "folder-1"
    assert result.label == "Roadmap"
    assert result.content == "Current plan"
    assert result.note_type == NodeType.SHEET


@pytest.mark.asyncio
async def test_get_note_tool_rejects_cross_board_notes() -> None:
    """Get note should fail when the note does not belong to the scoped board."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [Note(id="note-1", graph_uid="graph-2")]

    tool = create_get_note_tool(graph_store, "graph-1")

    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"note_id": "note-1"}),
    )

    assert isinstance(result, str)
    assert "does not belong to the current board scope" in result


@pytest.mark.asyncio
async def test_link_notes_tool_creates_link_with_label() -> None:
    """Link notes should create a Link between two notes in the current board scope."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [
        Note(id="src", graph_uid="graph-1"),
        Note(id="dst", graph_uid="graph-1"),
    ]

    tool = create_link_notes_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"source_id": "src", "target_id": "dst", "label": "causes"}),
    )

    assert result.type == "link_notes"
    assert result.source_id == "src"
    assert result.target_id == "dst"
    assert result.graph_uid == "graph-1"
    assert result.label == "causes"
    graph_store.add_links.assert_awaited_once()
    created_link = graph_store.add_links.await_args.args[0][0]
    assert created_link.source == "src"
    assert created_link.target == "dst"
    assert created_link.graph_uid == "graph-1"
    assert created_link.parent_id is None  # no folder scope -> top-level
    assert created_link.label is not None
    assert created_link.label.markdown == "causes"


@pytest.mark.asyncio
async def test_link_notes_tool_inherits_root_id_as_parent() -> None:
    """The new link must inherit root_id as its parent_id when a folder scope is set.

    Without this the link is filtered by the board's scope query on reload and only
    appears at the top-level board, even though both endpoints live in the folder.
    """
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [
        Note(id="src", graph_uid="graph-1"),
        Note(id="dst", graph_uid="graph-1"),
    ]

    tool = create_link_notes_tool(graph_store, "graph-1", root_id="folder-1")
    await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"source_id": "src", "target_id": "dst"}),
    )

    created_link = graph_store.add_links.await_args.args[0][0]
    assert created_link.parent_id == "folder-1"
    assert created_link.graph_uid == "graph-1"


@pytest.mark.asyncio
async def test_link_notes_tool_omits_label_when_none() -> None:
    """Link notes should leave the edge label unset when none is provided."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [
        Note(id="src", graph_uid="graph-1"),
        Note(id="dst", graph_uid="graph-1"),
    ]

    tool = create_link_notes_tool(graph_store, "graph-1")
    await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"source_id": "src", "target_id": "dst"}),
    )

    created_link = graph_store.add_links.await_args.args[0][0]
    assert created_link.label is None


@pytest.mark.asyncio
async def test_link_notes_tool_rejects_same_source_and_target() -> None:
    """Link notes should refuse self-loops to keep the graph sane."""
    graph_store = DummyGraphStore()
    tool = create_link_notes_tool(graph_store, "graph-1")

    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"source_id": "same", "target_id": "same"}),
    )

    assert isinstance(result, str)
    assert "must refer to different notes" in result
    graph_store.add_links.assert_not_awaited()


@pytest.mark.asyncio
async def test_link_notes_tool_rejects_missing_notes() -> None:
    """Link notes should fail when either endpoint does not exist."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [Note(id="src", graph_uid="graph-1")]  # missing dst

    tool = create_link_notes_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"source_id": "src", "target_id": "dst"}),
    )

    assert isinstance(result, str)
    assert "Note(s) not found" in result
    graph_store.add_links.assert_not_awaited()


@pytest.mark.asyncio
async def test_link_notes_tool_rejects_cross_board_notes() -> None:
    """Link notes should refuse endpoints from a different board scope."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [
        Note(id="src", graph_uid="graph-1"),
        Note(id="dst", graph_uid="graph-2"),
    ]

    tool = create_link_notes_tool(graph_store, "graph-1")
    result = await tool.on_invoke_tool(
        _make_tool_ctx(),
        json.dumps({"source_id": "src", "target_id": "dst"}),
    )

    assert isinstance(result, str)
    assert "does not belong to the current board scope" in result
    graph_store.add_links.assert_not_awaited()


@pytest.mark.asyncio
async def test_link_notes_tool_schema_hides_board_scope() -> None:
    """Link notes tool should expose only source, target, and label to the agent."""
    tool = create_link_notes_tool(DummyGraphStore(), "graph-1")

    properties = tool.params_json_schema["properties"]
    assert "graph_uid" not in properties
    assert "source_id" in properties
    assert "target_id" in properties
    assert "label" in properties
    required = set(tool.params_json_schema.get("required", []))
    assert {"source_id", "target_id"}.issubset(required)
