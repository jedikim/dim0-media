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
from topix.store.image_generation import ImageGenerationOutputWriterBusyError, ImageGenerationStore

GENERATED_IMAGE_RESULT_NAMESPACE = UUID("2f71a20e-d0f0-5b3f-a638-e8c6f04b0bc1")
RESULT_NODE_NAME_PREFIX = "dim0:image-result-node:"
RESULT_EDGE_NAME_PREFIX = "dim0:image-result-edge:"
RESULT_BATCH_NAME_PREFIX = "dim0:image-result-batch:"
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


def canonical_result_batch_uid(
    generation_uid: str,
    node_materialized_at: str,
    edge_materialized_at: str,
) -> str:
    """Derive one stable batch ID from both persisted result objects."""
    return uuid5(
        GENERATED_IMAGE_RESULT_NAMESPACE,
        f"{RESULT_BATCH_NAME_PREFIX}{generation_uid}:{node_materialized_at}:{edge_materialized_at}",
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
        note.deleted_at is None
        and note.graph_uid == record.board_uid
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
    _validate_result_edge_identity(
        link,
        record=record,
        generator_uid=generator_uid,
        node_uid=node_uid,
    )
    if link.parent_id != generator_parent_id:
        raise ImageResultNodeError(
            "canonical_collision",
            "The canonical generated image edge conflicts with existing board data.",
        )


def _validate_result_edge_identity(
    link: Link,
    *,
    record: ImageGenerationOutputRecord,
    generator_uid: str,
    node_uid: str,
) -> None:
    """Validate immutable edge identity independently from folder scope."""
    if (
        link.deleted_at is not None
        or link.graph_uid != record.board_uid
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
        record = await self._image_store.get_output_record(
            board_uid=board_uid,
            generation_uid=generation_uid,
        )
        if record is None:
            raise ImageResultNodeError(
                "generation_not_found",
                "Image generation not found.",
            )
        self._validate_generation(record, node_uid=node_uid)
        if record.output_node_uid is not None and not recreate:
            return self._outcome(record, node_uid, created=False, recreated=False)

        delivery = None
        outcome = None
        async with self._bridge.result_delivery_order(board_id=board_uid) as room:
            try:
                async with self._image_store.output_node_writer(
                    board_uid=board_uid,
                    generation_uid=generation_uid,
                ) as (writer_conn, owned_record):
                    if owned_record is None:
                        raise ImageResultNodeError(
                            "generation_not_found",
                            "Image generation not found.",
                        )
                    self._validate_generation(owned_record, node_uid=node_uid)
                    if owned_record.output_node_uid is not None and not recreate:
                        return self._outcome(
                            owned_record,
                            node_uid,
                            created=False,
                            recreated=False,
                        )

                    generator = await self._require_generator(owned_record)
                    await self._prepare_result_objects(
                        record=owned_record,
                        generator=generator,
                        node_uid=node_uid,
                        edge_uid=edge_uid,
                    )

                    async with self._image_store.output_node_transaction(
                        board_uid=board_uid,
                        generation_uid=generation_uid,
                        conn=writer_conn,
                    ) as (conn, locked_record):
                        if locked_record is None:
                            raise ImageResultNodeError(
                                "generation_not_found",
                                "Image generation not found.",
                            )
                        self._validate_generation(locked_record, node_uid=node_uid)
                        if locked_record.output_node_uid is not None and not recreate:
                            outcome = self._outcome(
                                locked_record,
                                node_uid,
                                created=False,
                                recreated=False,
                            )
                        else:
                            durable_generator = await self._require_generator(locked_record)
                            durable_node, durable_edge = await self._read_result_objects(
                                node_uid=node_uid,
                                edge_uid=edge_uid,
                            )
                            self._validate_prepared_result(
                                durable_node,
                                durable_edge,
                                record=locked_record,
                                generator=durable_generator,
                                node_uid=node_uid,
                            )
                            assert durable_node is not None and durable_edge is not None
                            batch_uid = canonical_result_batch_uid(
                                generation_uid,
                                durable_node.created_at,
                                durable_edge.created_at,
                            )
                            delivery = await self._bridge.ensure_result_batch(
                                conn,
                                board_id=board_uid,
                                batch_id=batch_uid,
                                note=durable_node,
                                link=durable_edge,
                                generator=durable_generator,
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
                            created = delivery is not None
                            outcome = self._outcome(
                                locked_record,
                                node_uid,
                                created=created,
                                recreated=locked_record.output_node_uid is not None and created,
                            )
            except ImageGenerationOutputWriterBusyError as exc:
                raise ImageResultNodeError(
                    "materialization_raced",
                    "Image result preparation overlapped with another operation. Please retry.",
                ) from exc
            await self._bridge.deliver_result_batch(room=room, delivery=delivery)
        assert outcome is not None
        return outcome

    async def _prepare_result_objects(
        self,
        *,
        record: ImageGenerationOutputRecord,
        generator: Note,
        node_uid: str,
        edge_uid: str,
    ) -> None:
        """Prepare missing objects and repair only recoverable unbound folder drift."""
        existing_node, existing_edge = await self._read_result_objects(
            node_uid=node_uid,
            edge_uid=edge_uid,
        )
        if existing_node is not None and existing_node.deleted_at is None:
            _validate_result_node(existing_node, record=record, generator_uid=generator.id)

        repair_node = None
        repair_edge = None
        if existing_edge is not None and existing_edge.deleted_at is None:
            _validate_result_edge_identity(
                existing_edge,
                record=record,
                generator_uid=generator.id,
                node_uid=node_uid,
            )
            if existing_edge.parent_id != generator.parent_id:
                if record.output_node_uid is not None:
                    _validate_result_edge(
                        existing_edge,
                        record=record,
                        generator_uid=generator.id,
                        generator_parent_id=generator.parent_id,
                        node_uid=node_uid,
                    )
                repair_edge = existing_edge.model_copy(
                    update={"parent_id": generator.parent_id},
                )

        if (
            record.output_node_uid is None
            and existing_node is not None
            and existing_node.deleted_at is None
            and existing_node.parent_id != generator.parent_id
        ):
            repair_node = existing_node.model_copy(
                update={"parent_id": generator.parent_id},
            )

        missing_node = existing_node is None or existing_node.deleted_at is not None
        missing_edge = existing_edge is None or existing_edge.deleted_at is not None
        expected_node = _build_result_note(record=record, generator=generator, node_uid=node_uid)
        expected_edge = _build_result_edge(
            record=record,
            generator=generator,
            node_uid=node_uid,
            edge_uid=edge_uid,
        )
        await self._bridge.persist_result_objects(
            board_id=record.board_uid,
            note=expected_node if missing_node else repair_node,
            link=expected_edge if missing_edge else repair_edge,
        )

    @staticmethod
    def _validate_prepared_result(
        node: Note | None,
        edge: Link | None,
        *,
        record: ImageGenerationOutputRecord,
        generator: Note,
        node_uid: str,
    ) -> None:
        """Validate the final Qdrant pair and surface recoverable scope races."""
        if node is None or node.deleted_at is not None or edge is None or edge.deleted_at is not None:
            raise ImageResultNodeError(
                "canvas_write_incomplete",
                "The generated image node could not be stored completely.",
            )
        _validate_result_node(node, record=record, generator_uid=generator.id)
        _validate_result_edge_identity(
            edge,
            record=record,
            generator_uid=generator.id,
            node_uid=node_uid,
        )
        if record.output_node_uid is None and (node.parent_id != generator.parent_id or edge.parent_id != generator.parent_id):
            raise ImageResultNodeError(
                "materialization_raced",
                "Image result preparation overlapped with another operation. Please retry.",
            )
        _validate_result_edge(
            edge,
            record=record,
            generator_uid=generator.id,
            generator_parent_id=generator.parent_id,
            node_uid=node_uid,
        )

    async def _require_generator(self, record: ImageGenerationOutputRecord) -> Note:
        """Return the live same-board generator or fail closed."""
        generator_uid = record.generator_node_uid
        assert generator_uid is not None
        rows = await self._graph_store.get_nodes([generator_uid])
        generator = rows[0] if rows else None
        if generator is None or generator.graph_uid != record.board_uid or generator.deleted_at is not None or not _is_generator(generator):
            raise ImageResultNodeError(
                "generator_unavailable",
                "The image generator node is unavailable.",
            )
        return generator

    async def _read_result_objects(
        self,
        *,
        node_uid: str,
        edge_uid: str,
    ) -> tuple[Note | None, Link | None]:
        """Read canonical result objects, including tombstones, in one stage."""
        nodes = await self._graph_store.get_nodes([node_uid])
        links = await self._graph_store.get_links([edge_uid])
        return (nodes[0] if nodes else None, links[0] if links else None)

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
