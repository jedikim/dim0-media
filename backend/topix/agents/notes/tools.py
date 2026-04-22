"""Primitive create/edit note tools scoped to the current board context."""

from __future__ import annotations

from typing import Literal

from agents import FunctionTool, RunContextWrapper

from topix.agents.datatypes.context import Context
from topix.agents.datatypes.outputs import CreateNoteOutput, EditNoteOutput, GetNoteOutput, WriteNoteOutput
from topix.agents.datatypes.tools import AgentToolName
from topix.agents.notes.service import (
    SHEET_MIN_HEIGHT,
    SHEET_MIN_WIDTH,
    build_note,
    get_default_note_size,
)
from topix.agents.tool_handler import ToolHandler
from topix.datatypes.note.style import NodeType
from topix.datatypes.property import SizeProperty
from topix.store.graph import GraphStore


def create_write_note_tool(
    graph_store: GraphStore,
    graph_uid: str,
    root_id: str | None = None,
) -> FunctionTool:
    """Build a write-note tool bound to the current board and optional folder scope."""

    async def write_note(
        _wrapper: RunContextWrapper[Context],
        content: str,
        label: str | None = None,
        note_type: NodeType = NodeType.RECTANGLE,
        note_id: str | None = None,
    ) -> WriteNoteOutput:
        """Create a new note or fully rewrite an existing note in the current board scope.

        Use this tool when you need to author full note content in one shot, including prose,
        markdown, code, or widget source. Omit `note_id` to create a new note. Provide
        `note_id` only when you intend to fully rewrite the authored fields of an existing note,
        perform a major restructure, or change the note type. For localized updates to an
        existing note, use `edit_note` instead. Always identify an existing note by `note_id`,
        never by label, because labels are descriptive and may change. If the user asks for a
        rich-text document or long-form note, use `note_type="sheet"`.

        Args:
            content (str): The complete note body after this write, such as prose, markdown, code, or widget source.
            label (str | None): Optional short title stored separately from the main body.
            note_type (NodeType): Visual note type to use after the write.
            note_id (str | None): Optional existing note id. Omit to create a new note.

        """
        if note_id is None:
            note = await build_note(
                graph_store=graph_store,
                graph_uid=graph_uid,
                label=label,
                content=content,
                note_type=note_type,
                parent_id=root_id,
            )
            await graph_store.add_notes([note])

            return WriteNoteOutput(
                action="created",
                note_id=note.id,
                graph_uid=graph_uid,
                label=label,
                note_type=note_type,
                parent_id=root_id,
            )

        existing_notes = await graph_store.get_nodes([note_id])
        if not existing_notes:
            raise ValueError(f"Note {note_id} was not found.")

        existing_note = existing_notes[0]
        if existing_note.graph_uid != graph_uid:
            raise ValueError("Note does not belong to the current board scope.")

        patch: dict = {
            "label": {"markdown": label} if label is not None else None,
            "content": {"markdown": content},
            "style": {"type": note_type},
        }
        if note_type != existing_note.style.type and note_type == NodeType.SHEET:
            existing_size = existing_note.properties.node_size.size
            needs_seed = (
                existing_size is None
                or existing_size.width < SHEET_MIN_WIDTH
                or existing_size.height < SHEET_MIN_HEIGHT
            )
            if needs_seed:
                width, height = get_default_note_size(note_type)
                patch.setdefault("properties", {})["node_size"] = SizeProperty(
                    size=SizeProperty.Size(width=width, height=height)
                ).model_dump()

        updated_note = await graph_store.patch_note(note_id, patch)
        if updated_note is None:
            raise ValueError(f"Note {note_id} was not found.")

        return WriteNoteOutput(
            action="rewritten",
            note_id=updated_note.id,
            graph_uid=graph_uid,
            label=updated_note.label.markdown if updated_note.label else None,
            note_type=updated_note.style.type,
            parent_id=updated_note.parent_id,
        )

    return ToolHandler.convert_func_to_tool(
        write_note,
        tool_name=AgentToolName.WRITE_NOTE,
        tool_description=None,
    )


def create_create_note_tool(
    graph_store: GraphStore,
    graph_uid: str,
    root_id: str | None = None,
) -> FunctionTool:
    """Build a create-note tool bound to the current board and optional folder scope."""

    async def create_note(
        _wrapper: RunContextWrapper[Context],
        content: str,
        label: str | None = None,
        note_type: NodeType = NodeType.RECTANGLE,
    ) -> CreateNoteOutput:
        """Create a note in the current board scope.

        Keep content short and concise, with only light markdown when helpful.
        DEPRECATED: prefer `write_note` for new integrations. This tool remains for
        backward compatibility.
        If the user asks for a rich-text document or long-form note, use `note_type="sheet"`.
        If the user asks for a code note or runnable snippet, use `code-sandbox` and put the code in `content`.
        If the user asks for an HTML widget, first use `learn_generate_html_widget`
            and then store the full HTML in `content` with `note_type="widget"`.

        Args:
            content (str): Main markdown body of the note. This is the most important text.
            label (str | None): Optional short title stored separately from the main body.
            note_type (NodeType): Visual note shape to create, such as rectangle or sheet.

        """
        note = await build_note(
            graph_store=graph_store,
            graph_uid=graph_uid,
            label=label,
            content=content,
            note_type=note_type,
            parent_id=root_id,
        )
        await graph_store.add_notes([note])

        return CreateNoteOutput(
            note_id=note.id,
            graph_uid=graph_uid,
            label=label,
            note_type=note_type,
            parent_id=root_id,
        )

    return ToolHandler.convert_func_to_tool(
        create_note,
        tool_name=AgentToolName.CREATE_NOTE,
        tool_description=None,
    )


def create_edit_note_tool(
    graph_store: GraphStore,
    graph_uid: str,
) -> FunctionTool:
    """Build an edit-note tool bound to the current board scope."""

    async def edit_note(
        _wrapper: RunContextWrapper[Context],
        note_id: str,
        field: Literal["label", "content"],
        old: str,
        new: str,
    ) -> EditNoteOutput:
        """Apply a targeted content edit to an existing note field in the current board scope.

        Use this as the default tool for localized changes to an existing note, including prose,
        markdown, code, or widget source. Multiple `edit_note` calls are preferred when several
        small updates are needed. Pass the exact current value in `old` so the update can fail
        safely if the note has changed since you last saw it. Always identify the target note by
        `note_id`, never by label, because labels are descriptive and may change.

        Args:
            note_id (str): Exact id of the note to update.
            field (Literal["label", "content"]): Which note field to edit.
            old (str): Exact current value expected for that field.
            new (str): Replacement value for that field.

        """
        existing_notes = await graph_store.get_nodes([note_id])
        if not existing_notes:
            raise ValueError(f"Note {note_id} was not found.")

        existing_note = existing_notes[0]
        if existing_note.graph_uid != graph_uid:
            raise ValueError("Note does not belong to the current board scope.")

        if field == "label":
            current_value = existing_note.label.markdown if existing_note.label is not None else ""
        else:
            current_value = existing_note.content.markdown if existing_note.content is not None else ""
        if current_value != old:
            raise ValueError(
                f"Note {note_id} {field} changed since it was read. "
                f"Expected {old!r} but found {current_value!r}."
            )

        patch: dict = {
            field: {"markdown": new},
        }

        updated_note = await graph_store.patch_note(note_id, patch)
        if updated_note is None:
            raise ValueError(f"Note {note_id} was not found.")

        return EditNoteOutput(
            note_id=updated_note.id,
            graph_uid=graph_uid,
            label=updated_note.label.markdown if updated_note.label else None,
            note_type=updated_note.style.type,
            parent_id=updated_note.parent_id,
        )

    return ToolHandler.convert_func_to_tool(
        edit_note,
        tool_name=AgentToolName.EDIT_NOTE,
        tool_description=None,
    )


def create_get_note_tool(
    graph_store: GraphStore,
    graph_uid: str,
) -> FunctionTool:
    """Build a get-note tool bound to the current board scope."""

    async def get_note(
        _wrapper: RunContextWrapper[Context],
        note_id: str,
    ) -> GetNoteOutput:
        """Read the current content and metadata of an existing note by exact note id.

        Use this tool when you already know a note id and need to inspect the note again
        before editing or rewriting it. Always identify existing notes by `note_id`, not by
        label, because labels are descriptive and may be duplicated or changed.

        Args:
            note_id (str): Exact id of the note to fetch.

        """
        existing_notes = await graph_store.get_nodes([note_id])
        if not existing_notes:
            raise ValueError(f"Note {note_id} was not found.")

        note = existing_notes[0]
        if note.graph_uid != graph_uid:
            raise ValueError("Note does not belong to the current board scope.")

        return GetNoteOutput(
            note_id=note.id,
            graph_uid=note.graph_uid,
            label=note.label.markdown if note.label else None,
            content=note.content.markdown if note.content else "",
            note_type=note.style.type,
            parent_id=note.parent_id,
        )

    return ToolHandler.convert_func_to_tool(
        get_note,
        tool_name=AgentToolName.GET_NOTE,
        tool_description=None,
    )
