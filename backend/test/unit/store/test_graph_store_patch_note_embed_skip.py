"""Tests for the patch_note embed-skip fast path.

A position-only (or other spatial) patch must not call the embedder —
the OpenAI roundtrip is the dominant cost for collab apply latency.
A patch that changes embeddable text (label / content / searchable
TextProperties) must still re-embed.
"""

from __future__ import annotations

import asyncio

from unittest.mock import AsyncMock

import pytest

from topix.datatypes.note.note import Note
from topix.datatypes.resource import RichText
from topix.store.graph import GraphStore


def _build_store() -> GraphStore:
    store = object.__new__(GraphStore)
    store._content_store = AsyncMock()
    store._pg_pool = None
    store._owns_pool = False
    store._note_revision_store = None
    store._note_locks = {}
    store._snapshot_sem = asyncio.Semaphore(8)
    store._snapshot_tasks = set()
    return store


def _build_note() -> Note:
    return Note(
        id="n1",
        graph_uid="b1",
        label=RichText(markdown="Hello"),
        content=RichText(markdown="World"),
    )


@pytest.mark.asyncio
async def test_position_only_patch_skips_embed() -> None:
    """Updating x/y leaves to_embeddable() unchanged → no full re-embed."""
    store = _build_store()
    note = _build_note()
    store.get_nodes = AsyncMock(return_value=[note])
    store._content_store.update = AsyncMock()
    store._content_store.update_payload_only = AsyncMock()

    await store.patch_note(
        node_id="n1",
        data={
            "properties": {
                "node_position": {
                    "type": "position",
                    "position": {"x": 200, "y": 150},
                }
            }
        },
        user_uid="u1",
    )

    store._content_store.update_payload_only.assert_awaited_once()
    store._content_store.update.assert_not_awaited()


@pytest.mark.asyncio
async def test_size_only_patch_skips_embed() -> None:
    """Resize is also embed-free."""
    store = _build_store()
    note = _build_note()
    store.get_nodes = AsyncMock(return_value=[note])
    store._content_store.update = AsyncMock()
    store._content_store.update_payload_only = AsyncMock()

    await store.patch_note(
        node_id="n1",
        data={
            "properties": {
                "node_size": {
                    "type": "size",
                    "size": {"width": 400, "height": 250},
                }
            }
        },
        user_uid="u1",
    )

    store._content_store.update_payload_only.assert_awaited_once()
    store._content_store.update.assert_not_awaited()


@pytest.mark.asyncio
async def test_style_only_patch_skips_embed() -> None:
    """Cosmetic style changes (colors, font) don't touch embeddable text."""
    store = _build_store()
    note = _build_note()
    store.get_nodes = AsyncMock(return_value=[note])
    store._content_store.update = AsyncMock()
    store._content_store.update_payload_only = AsyncMock()

    await store.patch_note(
        node_id="n1",
        data={"style": {"color": {"bg": "#ff0000", "stroke": "#000", "text": "#fff"}}},
        user_uid="u1",
    )

    store._content_store.update_payload_only.assert_awaited_once()
    store._content_store.update.assert_not_awaited()


@pytest.mark.asyncio
async def test_content_change_triggers_full_re_embed() -> None:
    """Patching content.markdown invalidates the vector — must re-embed."""
    store = _build_store()
    note = _build_note()
    store.get_nodes = AsyncMock(return_value=[note])
    store._content_store.update = AsyncMock()
    store._content_store.update_payload_only = AsyncMock()

    await store.patch_note(
        node_id="n1",
        data={"content": {"markdown": "Brand new body"}},
        user_uid="u1",
    )

    store._content_store.update.assert_awaited_once()
    store._content_store.update_payload_only.assert_not_awaited()


@pytest.mark.asyncio
async def test_label_change_triggers_full_re_embed() -> None:
    """Same for label — label.markdown is part of to_embeddable()."""
    store = _build_store()
    note = _build_note()
    store.get_nodes = AsyncMock(return_value=[note])
    store._content_store.update = AsyncMock()
    store._content_store.update_payload_only = AsyncMock()

    await store.patch_note(
        node_id="n1",
        data={"label": {"markdown": "Renamed"}},
        user_uid="u1",
    )

    store._content_store.update.assert_awaited_once()
    store._content_store.update_payload_only.assert_not_awaited()


@pytest.mark.asyncio
async def test_combined_position_and_content_takes_full_path() -> None:
    """If any embeddable text changes, embed regardless of other fields."""
    store = _build_store()
    note = _build_note()
    store.get_nodes = AsyncMock(return_value=[note])
    store._content_store.update = AsyncMock()
    store._content_store.update_payload_only = AsyncMock()

    await store.patch_note(
        node_id="n1",
        data={
            "properties": {
                "node_position": {
                    "type": "position",
                    "position": {"x": 1, "y": 2},
                }
            },
            "content": {"markdown": "different"},
        },
        user_uid="u1",
    )

    store._content_store.update.assert_awaited_once()
    store._content_store.update_payload_only.assert_not_awaited()


@pytest.mark.asyncio
async def test_patch_with_identical_text_still_skips_embed() -> None:
    """Patches whose embeddable text is unchanged take the fast path.

    `to_embeddable()` equality is what matters, not whether the patch
    dict had a `content` key.
    """
    store = _build_store()
    note = _build_note()
    store.get_nodes = AsyncMock(return_value=[note])
    store._content_store.update = AsyncMock()
    store._content_store.update_payload_only = AsyncMock()

    await store.patch_note(
        node_id="n1",
        data={"content": {"markdown": "World"}},  # same as existing
        user_uid="u1",
    )

    store._content_store.update_payload_only.assert_awaited_once()
    store._content_store.update.assert_not_awaited()
