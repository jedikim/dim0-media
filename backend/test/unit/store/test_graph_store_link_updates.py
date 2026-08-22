"""Regression tests for validated link patch merging."""

from unittest.mock import AsyncMock

import pytest

from pydantic import ValidationError

from topix.collab.note_to_wire import link_to_wire_edge
from topix.datatypes.note.link import IMAGE_REFERENCE_EDGE_MARKER, Link
from topix.store.graph import GraphStore


def _link(properties: dict | None = None) -> Link:
    """Build one legacy-compatible link payload."""
    return Link.model_validate(
        {
            "id": "edge-1",
            "source": "source-1",
            "target": "target-1",
            "graph_uid": "board-1",
            "properties": properties or {},
        }
    )


def _store(link: Link) -> tuple[GraphStore, AsyncMock]:
    """Build a GraphStore whose content boundary is recorded in memory."""
    store = GraphStore.__new__(GraphStore)
    content_store = AsyncMock()
    store._content_store = content_store
    store.get_links = AsyncMock(return_value=[link])
    return store, content_store


@pytest.mark.asyncio
async def test_single_link_clear_deletes_marker_keys_and_preserves_other_properties() -> None:
    """A single clear removes keys rather than persisting invalid nulls."""
    store, content_store = _store(
        _link(
            {
                "edge_control_point": {
                    "type": "position",
                    "position": {"x": 10, "y": 20},
                },
                "custom": {"type": "keyword", "value": "keep"},
                "image_reference": {
                    "type": "keyword",
                    "value": IMAGE_REFERENCE_EDGE_MARKER,
                },
                "image_reference_ordinal": {"type": "number", "number": 2},
            }
        )
    )

    await store.update_link(
        "edge-1",
        {
            "properties": {
                "image_reference": None,
                "image_reference_ordinal": None,
            }
        },
    )

    [payload] = content_store.update.await_args.args[0]
    assert "image_reference" not in payload["properties"]
    assert "image_reference_ordinal" not in payload["properties"]
    assert payload["properties"]["custom"]["value"] == "keep"
    assert payload["properties"]["edge_control_point"]["position"] == {"x": 10.0, "y": 20.0}
    assert "imageReference" not in link_to_wire_edge(Link.model_validate(payload)).get("data", {})


@pytest.mark.asyncio
async def test_bulk_set_then_clear_validates_all_before_one_final_write() -> None:
    """Repeated same-ID patches preserve input order and store only the final state."""
    store, content_store = _store(_link({"custom": {"type": "text", "text": "keep"}}))

    await store.update_links(
        [
            (
                "edge-1",
                {
                    "properties": {
                        "image_reference": {
                            "type": "keyword",
                            "value": IMAGE_REFERENCE_EDGE_MARKER,
                        },
                        "image_reference_ordinal": {"type": "number", "number": 0},
                    }
                },
            ),
            (
                "edge-1",
                {
                    "properties": {
                        "image_reference": None,
                        "image_reference_ordinal": None,
                    }
                },
            ),
        ]
    )

    [payload] = content_store.update.await_args.args[0]
    assert "image_reference" not in payload["properties"]
    assert "image_reference_ordinal" not in payload["properties"]
    assert payload["properties"]["custom"]["text"] == "keep"


@pytest.mark.asyncio
async def test_invalid_bulk_merge_raises_before_content_store_write() -> None:
    """One invalid merged patch fails the whole link bucket before persistence."""
    store, content_store = _store(_link())

    with pytest.raises(ValidationError):
        await store.update_links(
            [
                ("edge-1", {"properties": {"custom": {"type": "keyword", "value": "ok"}}}),
                ("edge-1", {"properties": {"broken": {"type": "position", "position": {"x": "bad", "y": 1}}}}),
            ]
        )

    content_store.update.assert_not_awaited()


@pytest.mark.parametrize(
    "properties",
    [
        {},
        {"start_point": {"type": "position", "position": {"x": 1, "y": 2}}},
        {
            "start_point": {
                "id": "position-id",
                "type": "position",
                "position": {"x": 1, "y": 2},
                "is_local_offset": False,
            }
        },
        {
            "end_point": {
                "type": "position",
                "position": {"x": 3, "y": 4},
                "is_local_offset": True,
            }
        },
        {"edge_control_point": {"type": "position", "position": None}},
        {"custom": {"type": "keyword", "value": "legacy"}},
        {"edge_control_point": {"type": "keyword", "value": "legacy-non-position"}},
    ],
)
def test_legacy_link_property_shapes_remain_accepted(properties: dict) -> None:
    """The delete-on-null merge keeps the broad historical property contract."""
    assert _link(properties).properties is not None


def test_legacy_free_endpoint_link_remains_accepted() -> None:
    """World-position endpoints with empty node sentinels keep loading unchanged."""
    link = Link.model_validate(
        {
            "source": "",
            "target": "",
            "properties": {
                "start_point": {"type": "position", "position": {"x": 1, "y": 2}},
                "end_point": {"type": "position", "position": {"x": 3, "y": 4}},
            },
        }
    )
    assert link.source == "" and link.target == ""
