"""Idempotent canvas materialization for successful image generations."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid5

from topix.collab.agent_bridge import AgentBoardBridge
from topix.datatypes.note.link import Link
from topix.datatypes.note.note import (
    GENERATED_IMAGE_MARKER_VALUE,
    Note,
    NoteProperties,
)
from topix.datatypes.note.style import NodeType, Style
from topix.datatypes.property import KeywordProperty, NumberProperty, PositionProperty, SizeProperty
from topix.image_generation.models import GenerationStatus, ImageGenerationOutputRecord
from topix.store.graph import GraphStore
from topix.store.image_generation import ImageGenerationStore

GENERATED_IMAGE_RESULT_NAMESPACE = UUID("2f71a20e-d0f0-5b3f-a638-e8c6f04b0bc1")
RESULT_NODE_NAME_PREFIX = "dim0:image-result-node:"
RESULT_EDGE_NAME_PREFIX = "dim0:image-result-edge:"
RESULT_MAX_SIDE = 420.0
RESULT_GAP = 80.0


class ImageResultNodeError(Exception):
    """Expose a stable code and safe message for output-node failures."""

    def __init__(self, code: str, safe_message: str) -> None:
        """Initialize one provider-free materialization failure."""
        super().__init__(safe_message)
        self.code = code
        self.safe_message = safe_message


@dataclass(frozen=True)
class ImageResultNodeOutcome:
    """Return the authoritative result-node association to the API."""

    generation_uid: str
    output_node_uid: str
    output_asset_uid: str
    created: bool
    recreated: bool


def canonical_result_node_uid(generation_uid: str) -> str:
    """Derive one stable lowercase 32-character result node ID."""
    return uuid5(
        GENERATED_IMAGE_RESULT_NAMESPACE,
        f"{RESULT_NODE_NAME_PREFIX}{generation_uid}",
    ).hex


def canonical_result_edge_uid(generation_uid: str) -> str:
    """Derive one stable lowercase 32-character result edge ID."""
    return uuid5(
        GENERATED_IMAGE_RESULT_NAMESPACE,
        f"{RESULT_EDGE_NAME_PREFIX}{generation_uid}",
    ).hex


def _keyword_value(properties: NoteProperties, name: str) -> str | None:
    """Read one string KeywordProperty without accepting arbitrary values."""
    property_value = getattr(properties, name, None)
    value = getattr(property_value, "value", None)
    return value if isinstance(value, str) and value else None


def _is_generator(note: Note) -> bool:
    """Return whether a Note carries the established generator marker."""
    return getattr(note.properties, "image_prompt", None) is not None


def _result_size(record: ImageGenerationOutputRecord) -> tuple[float, float]:
    """Scale the immutable asset ratio into a stable canvas footprint."""
    if record.output_width is None or record.output_height is None:
        raise ImageResultNodeError(
            "output_asset_unavailable",
            "The generated image metadata is unavailable.",
        )
    scale = RESULT_MAX_SIDE / max(record.output_width, record.output_height)
    return record.output_width * scale, record.output_height * scale


def _build_result_note(
    *,
    record: ImageGenerationOutputRecord,
    generator: Note,
    node_uid: str,
) -> Note:
    """Build the canonical immutable result Note beside its generator."""
    if record.output_asset_uid is None:
        raise ImageResultNodeError(
            "output_asset_unavailable",
            "The generated image asset is unavailable.",
        )
    width, height = _result_size(record)
    generator_position = generator.properties.node_position.position
    generator_size = generator.properties.node_size.size
    generator_z = generator.properties.node_z_index.number or 0
    if generator_position is None or generator_size is None:
        raise ImageResultNodeError(
            "generator_unavailable",
            "The image generator node is unavailable.",
        )
    return Note(
        id=node_uid,
        graph_uid=record.board_uid,
        parent_id=generator.parent_id,
        style=Style(type=NodeType.RECTANGLE),
        properties=NoteProperties(
            node_position=PositionProperty(
                position=PositionProperty.Position(
                    x=generator_position.x + generator_size.width + RESULT_GAP,
                    y=generator_position.y,
                )
            ),
            node_size=SizeProperty(size=SizeProperty.Size(width=width, height=height)),
            node_z_index=NumberProperty(number=float(generator_z) + 1),
            image_asset_uid=KeywordProperty(value=record.output_asset_uid),
            generated_image_marker=KeywordProperty(value=GENERATED_IMAGE_MARKER_VALUE),
            generated_image_generation_uid=KeywordProperty(value=record.generation_uid),
            generated_image_generator_node_uid=KeywordProperty(value=generator.id),
        ),
    )


def _build_result_edge(
    *,
    record: ImageGenerationOutputRecord,
    generator: Note,
    node_uid: str,
    edge_uid: str,
) -> Link:
    """Build the ordinary visual generator-to-result edge."""
    return Link(
        id=edge_uid,
        source=generator.id,
        target=node_uid,
        graph_uid=record.board_uid,
        parent_id=generator.parent_id,
    )


def _validate_result_node(
    note: Note,
    *,
    record: ImageGenerationOutputRecord,
    generator_uid: str,
) -> None:
    """Fail closed when a canonical node ID belongs to different content."""
    properties = note.properties
    valid = (
        note.graph_uid == record.board_uid
        and _keyword_value(properties, "generated_image_marker") == GENERATED_IMAGE_MARKER_VALUE
        and _keyword_value(properties, "image_asset_uid") == record.output_asset_uid
        and _keyword_value(properties, "generated_image_generation_uid") == record.generation_uid
        and _keyword_value(properties, "generated_image_generator_node_uid") == generator_uid
    )
    if not valid:
        raise ImageResultNodeError(
            "canonical_collision",
            "The canonical generated image node conflicts with existing board data.",
        )


def _validate_result_edge(
    link: Link,
    *,
    record: ImageGenerationOutputRecord,
    generator_uid: str,
    generator_parent_id: str | None,
    node_uid: str,
) -> None:
    """Fail closed when a canonical edge ID has different endpoints or scope."""
    if (
        link.graph_uid != record.board_uid
        or link.parent_id != generator_parent_id
        or link.source != generator_uid
        or link.target != node_uid
        or getattr(link.properties, "image_reference", None) is not None
    ):
        raise ImageResultNodeError(
            "canonical_collision",
            "The canonical generated image edge conflicts with existing board data.",
        )


class ImageResultNodeService:
    """Reconcile one successful generation into canonical canvas objects."""

    def __init__(
        self,
        *,
        image_store: ImageGenerationStore,
        graph_store: GraphStore,
        bridge: AgentBoardBridge,
    ) -> None:
        """Reuse the existing generation, graph, and collaboration stores."""
        self._image_store = image_store
        self._graph_store = graph_store
        self._bridge = bridge

    async def ensure_output_node(
        self,
        *,
        board_uid: str,
        generation_uid: str,
        recreate: bool,
    ) -> ImageResultNodeOutcome:
        """Create, recover, or explicitly recreate one canonical result."""
        node_uid = canonical_result_node_uid(generation_uid)
        edge_uid = canonical_result_edge_uid(generation_uid)
        async with self._image_store.output_node_transaction(
            board_uid=board_uid,
            generation_uid=generation_uid,
        ) as (conn, record):
            if record is None:
                raise ImageResultNodeError(
                    "generation_not_found",
                    "Image generation not found.",
                )
            self._validate_generation(record, node_uid=node_uid)

            generator_uid = record.generator_node_uid
            assert generator_uid is not None
            generator_rows = await self._graph_store.get_nodes([generator_uid])
            generator = generator_rows[0] if generator_rows else None
            if generator is None or generator.graph_uid != board_uid or generator.deleted_at is not None or not _is_generator(generator):
                raise ImageResultNodeError(
                    "generator_unavailable",
                    "The image generator node is unavailable.",
                )

            nodes = await self._graph_store.get_nodes([node_uid])
            links = await self._graph_store.get_links([edge_uid])
            existing_node = nodes[0] if nodes else None
            existing_edge = links[0] if links else None
            if existing_node is not None:
                _validate_result_node(
                    existing_node,
                    record=record,
                    generator_uid=generator_uid,
                )
            if existing_edge is not None:
                _validate_result_edge(
                    existing_edge,
                    record=record,
                    generator_uid=generator_uid,
                    generator_parent_id=generator.parent_id,
                    node_uid=node_uid,
                )

            if record.output_node_uid is not None and not recreate:
                return self._outcome(record, node_uid, created=False, recreated=False)

            node_created = False
            edge_created = False
            expected_node = _build_result_note(
                record=record,
                generator=generator,
                node_uid=node_uid,
            )
            if existing_node is None:
                await self._bridge.add_notes(board_id=board_uid, notes=[expected_node])
                node_created = True
            expected_edge = _build_result_edge(
                record=record,
                generator=generator,
                node_uid=node_uid,
                edge_uid=edge_uid,
            )
            if existing_edge is None:
                await self._bridge.add_links(board_id=board_uid, links=[expected_edge])
                edge_created = True

            durable_nodes = await self._graph_store.get_nodes([node_uid])
            durable_links = await self._graph_store.get_links([edge_uid])
            if not durable_nodes or not durable_links:
                raise ImageResultNodeError(
                    "canvas_write_incomplete",
                    "The generated image node could not be stored completely.",
                )
            _validate_result_node(
                durable_nodes[0],
                record=record,
                generator_uid=generator_uid,
            )
            _validate_result_edge(
                durable_links[0],
                record=record,
                generator_uid=generator_uid,
                generator_parent_id=generator.parent_id,
                node_uid=node_uid,
            )
            if not await self._image_store.bind_output_node(
                conn,
                board_uid=board_uid,
                generation_uid=generation_uid,
                output_node_uid=node_uid,
            ):
                raise ImageResultNodeError(
                    "output_binding_conflict",
                    "The generated image node could not be linked to its generation.",
                )
            return self._outcome(
                record,
                node_uid,
                created=node_created or edge_created,
                recreated=record.output_node_uid is not None and (node_created or edge_created),
            )

    @staticmethod
    def _validate_generation(
        record: ImageGenerationOutputRecord,
        *,
        node_uid: str,
    ) -> None:
        """Require one succeeded run with a canonical canvas association."""
        if record.status != GenerationStatus.SUCCEEDED:
            raise ImageResultNodeError(
                "generation_not_succeeded",
                "Only a succeeded image generation can create a result node.",
            )
        if record.output_asset_uid is None or record.output_mime_type is None or record.output_width is None or record.output_height is None:
            raise ImageResultNodeError(
                "output_asset_unavailable",
                "The generated image asset is unavailable.",
            )
        if record.generator_node_uid is None:
            raise ImageResultNodeError(
                "generator_unavailable",
                "The image generator node is unavailable.",
            )
        if record.output_node_uid not in {None, node_uid}:
            raise ImageResultNodeError(
                "canonical_collision",
                "The generation is linked to a non-canonical result node.",
            )

    @staticmethod
    def _outcome(
        record: ImageGenerationOutputRecord,
        node_uid: str,
        *,
        created: bool,
        recreated: bool,
    ) -> ImageResultNodeOutcome:
        """Build an outcome after the generation contract was validated."""
        assert record.output_asset_uid is not None
        return ImageResultNodeOutcome(
            generation_uid=record.generation_uid,
            output_node_uid=node_uid,
            output_asset_uid=record.output_asset_uid,
            created=created,
            recreated=recreated,
        )
