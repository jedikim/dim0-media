"""Class representing the data for an edge in a graph."""

from pydantic import Field
from typing_extensions import Literal

from topix.datatypes.note.style import LinkStyle
from topix.datatypes.property import DataProperty, KeywordProperty, NumberProperty, PositionProperty
from topix.datatypes.resource import Resource, ResourceProperties

IMAGE_REFERENCE_EDGE_MARKER = "image-generator-reference"


class LinkProperties(ResourceProperties):
    """Link properties."""

    __pydantic_extra__: dict[str, DataProperty] = Field(init=False)

    edge_control_point: PositionProperty = Field(default_factory=lambda: PositionProperty())
    start_point: PositionProperty | None = None
    end_point: PositionProperty | None = None
    image_reference: KeywordProperty | None = None
    image_reference_ordinal: NumberProperty | None = None


class Link(Resource):
    """Data for a link in a graph."""

    type: Literal["link"] = "link"

    source: str
    target: str

    style: LinkStyle = Field(default_factory=LinkStyle)

    graph_uid: str | None = None
    parent_id: str | None = None
