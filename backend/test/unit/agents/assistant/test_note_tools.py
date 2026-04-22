"""Tests for the primitive board-scoped note tools."""

from __future__ import annotations

import json

from unittest.mock import ANY, AsyncMock

import pytest

from agents import RunContextWrapper

from topix.agents.datatypes.context import Context
from topix.agents.notes.service import build_note, get_default_note_size
from topix.agents.notes.tools import (
    create_edit_note_tool,
    create_get_note_tool,
    create_write_note_tool,
)
from topix.datatypes.note.note import Note
from topix.datatypes.note.style import NodeType
from topix.datatypes.resource import RichText


class DummyGraphStore:
    """Minimal graph-store stub for note tool tests."""

    def __init__(self):
        """Initialize async methods used by note tools."""
        self.add_notes = AsyncMock()
        self.get_graph = AsyncMock(return_value=type("Graph", (), {"nodes": []})())
        self.get_nodes = AsyncMock(return_value=[])
        self.patch_note = AsyncMock()


@pytest.mark.asyncio
async def test_build_note_uses_frontend_aligned_defaults() -> None:
    """New note helpers should mirror the frontend size defaults."""
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
    assert note.properties.node_size.size.width == 320
    assert note.properties.node_size.size.height == 200
    assert note.properties.node_position.position.x == 0
    assert note.properties.node_position.position.y == 0


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
    assert note.properties.node_size.size.width == 360
    assert note.properties.node_size.size.height == 260


@pytest.mark.asyncio
async def test_build_inscribed_shapes_use_larger_square_defaults() -> None:
    """Ellipse and diamond families should start from roomier square defaults."""
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

    assert ellipse_note.properties.node_size.size.width == 320
    assert ellipse_note.properties.node_size.size.height == 320
    assert diamond_note.properties.node_size.size.width == 340
    assert diamond_note.properties.node_size.size.height == 340


@pytest.mark.asyncio
async def test_write_note_tool_creates_note_in_root_scope_by_default() -> None:
    """Write note should create a note in the current root folder when note_id is omitted."""
    graph_store = DummyGraphStore()
    tool = create_write_note_tool(graph_store, "graph-1", root_id="folder-1")

    result = await tool.on_invoke_tool(
        RunContextWrapper(Context()),
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
    assert created_note.properties.node_size.size.width == get_default_note_size(NodeType.RECTANGLE)[0]


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
        RunContextWrapper(Context()),
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
                        "width": 320.0,
                        "height": 200.0,
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
        RunContextWrapper(Context()),
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
        RunContextWrapper(Context()),
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


@pytest.mark.asyncio
async def test_edit_note_tool_rejects_cross_board_notes() -> None:
    """Edit note should fail when the note does not belong to the scoped board."""
    graph_store = DummyGraphStore()
    graph_store.get_nodes.return_value = [Note(id="note-1", graph_uid="graph-2")]

    tool = create_edit_note_tool(graph_store, "graph-1")

    result = await tool.on_invoke_tool(
        RunContextWrapper(Context()),
        json.dumps({"note_id": "note-1", "field": "label", "old": "", "new": "Nope"}),
    )

    assert isinstance(result, str)
    assert "does not belong to the current board scope" in result


@pytest.mark.asyncio
async def test_edit_note_tool_rejects_stale_old_value() -> None:
    """Edit note should fail safely when the note changed since it was read."""
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
        RunContextWrapper(Context()),
        json.dumps({"note_id": "note-1", "field": "content", "old": "Old", "new": "After"}),
    )

    assert isinstance(result, str)
    assert "changed since it was read" in result


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
        RunContextWrapper(Context()),
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
        RunContextWrapper(Context()),
        json.dumps({"note_id": "note-1"}),
    )

    assert isinstance(result, str)
    assert "does not belong to the current board scope" in result
