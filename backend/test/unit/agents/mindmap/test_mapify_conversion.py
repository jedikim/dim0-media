"""Tests for converting Mapify output into board notes and links."""

from topix.agents.datatypes.outputs import MapifyTheme
from topix.agents.mindmap.mapify import convert_mapify_output_to_notes_links
from topix.datatypes.note.style import NodeType


def test_convert_mapify_output_uses_layered_circle_for_root() -> None:
    """Mapify should promote the root node to a layered circle while keeping children rectangular."""
    output = MapifyTheme(
        label="Root topic",
        description="Root summary",
        subthemes=[
            MapifyTheme(
                label="Child topic",
                description="Child summary",
                subthemes=[],
            )
        ],
    )

    notes, links = convert_mapify_output_to_notes_links(output)

    assert len(notes) == 2
    assert len(links) == 1
    assert notes[0].style.type == NodeType.LAYERED_CIRCLE
    assert notes[1].style.type == NodeType.RECTANGLE
