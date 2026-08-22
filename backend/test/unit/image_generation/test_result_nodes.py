"""Unit tests for canonical generated-image canvas materialization."""

from __future__ import annotations

import asyncio

from contextlib import asynccontextmanager

import pytest

from topix.datatypes.note.link import Link
from topix.datatypes.note.note import Note, NoteProperties
from topix.datatypes.property import TextProperty
from topix.image_generation.models import GenerationStatus, ImageGenerationOutputRecord
from topix.image_generation.result_nodes import (
    ImageResultNodeError,
    ImageResultNodeService,
    canonical_result_edge_uid,
    canonical_result_node_uid,
)

BOARD_UID = "b" * 32
GENERATION_UID = "g" * 32
GENERATOR_UID = "n" * 32
ASSET_UID = "a" * 32


def _record(**updates) -> ImageGenerationOutputRecord:
    """Build one succeeded generation with immutable output metadata."""
    values = {
        "generation_uid": GENERATION_UID,
        "board_uid": BOARD_UID,
        "status": GenerationStatus.SUCCEEDED,
        "generator_node_uid": GENERATOR_UID,
        "output_node_uid": None,
        "output_asset_uid": ASSET_UID,
        "output_mime_type": "image/png",
        "output_width": 1200,
        "output_height": 800,
    }
    values.update(updates)
    return ImageGenerationOutputRecord(**values)


def _generator() -> Note:
    """Build a same-board Image Generator marker Note."""
    return Note(
        id=GENERATOR_UID,
        graph_uid=BOARD_UID,
        properties=NoteProperties(image_prompt=TextProperty(text="a red leaf")),
    )


class _FakeImageStore:
    """Expose the output transaction and record binds without PostgreSQL."""

    def __init__(self, record: ImageGenerationOutputRecord | None) -> None:
        """Initialize one mutable authoritative generation record."""
        self.record = record
        self.bind_calls: list[str] = []
        self.bind_succeeds = True
        self.lock = asyncio.Lock()

    @asynccontextmanager
    async def output_node_transaction(self, *, board_uid: str, generation_uid: str):
        """Yield the configured record as if the advisory lock were held."""
        assert board_uid == BOARD_UID
        assert generation_uid == GENERATION_UID
        async with self.lock:
            yield object(), self.record

    async def bind_output_node(
        self,
        _conn,
        *,
        board_uid: str,
        generation_uid: str,
        output_node_uid: str,
    ) -> bool:
        """Record a canonical bind and optionally simulate commit failure."""
        assert board_uid == BOARD_UID
        assert generation_uid == GENERATION_UID
        self.bind_calls.append(output_node_uid)
        if self.bind_succeeds and self.record is not None:
            self.record = self.record.model_copy(update={"output_node_uid": output_node_uid})
        return self.bind_succeeds


class _FakeGraphStore:
    """Store canonical Notes and Links in memory for reconciliation tests."""

    def __init__(self) -> None:
        """Initialize the graph with its generator only."""
        generator = _generator()
        self.nodes = {generator.id: generator}
        self.links: dict[str, Link] = {}

    async def get_nodes(self, node_ids: list[str]) -> list[Note]:
        """Return requested Notes in input order."""
        return [self.nodes[node_id] for node_id in node_ids if node_id in self.nodes]

    async def get_links(self, link_ids: list[str]) -> list[Link]:
        """Return requested Links in input order."""
        return [self.links[link_id] for link_id in link_ids if link_id in self.links]


class _FakeBridge:
    """Persist through the fake graph while recording collaboration writes."""

    def __init__(self, graph: _FakeGraphStore) -> None:
        """Bind one graph and initialize failure controls."""
        self.graph = graph
        self.note_calls = 0
        self.link_calls = 0
        self.fail_links = False

    async def add_notes(self, *, board_id: str, notes: list[Note]) -> None:
        """Store Notes exactly as AgentBoardBridge would before broadcast."""
        assert board_id == BOARD_UID
        self.note_calls += 1
        self.graph.nodes.update({note.id: note for note in notes})

    async def add_links(self, *, board_id: str, links: list[Link]) -> None:
        """Store Links or simulate a partial node-only write."""
        assert board_id == BOARD_UID
        self.link_calls += 1
        if self.fail_links:
            raise RuntimeError("synthetic link failure")
        self.graph.links.update({link.id: link for link in links})


def _service(record: ImageGenerationOutputRecord | None = None):
    """Build a result service with observable local fakes."""
    image_store = _FakeImageStore(record if record is not None else _record())
    graph = _FakeGraphStore()
    bridge = _FakeBridge(graph)
    service = ImageResultNodeService(
        image_store=image_store,  # type: ignore[arg-type]
        graph_store=graph,  # type: ignore[arg-type]
        bridge=bridge,  # type: ignore[arg-type]
    )
    return service, image_store, graph, bridge


def test_canonical_ids_are_stable_distinct_lowercase_hex() -> None:
    """Node and edge IDs use distinct deterministic UUID5 names."""
    node_uid = canonical_result_node_uid(GENERATION_UID)
    edge_uid = canonical_result_edge_uid(GENERATION_UID)
    assert node_uid == canonical_result_node_uid(GENERATION_UID)
    assert edge_uid == canonical_result_edge_uid(GENERATION_UID)
    assert node_uid != edge_uid
    assert len(node_uid) == len(edge_uid) == 32
    assert node_uid == node_uid.lower()
    assert edge_uid == edge_uid.lower()
    int(node_uid, 16)
    int(edge_uid, 16)
    assert canonical_result_node_uid("other") != node_uid


@pytest.mark.asyncio
async def test_automatic_ensure_creates_node_edge_then_binds() -> None:
    """A succeeded run becomes one immutable node and ordinary edge."""
    service, image_store, graph, bridge = _service()

    outcome = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )

    node_uid = canonical_result_node_uid(GENERATION_UID)
    edge_uid = canonical_result_edge_uid(GENERATION_UID)
    assert outcome.output_node_uid == node_uid
    assert outcome.output_asset_uid == ASSET_UID
    assert outcome.created is True
    assert outcome.recreated is False
    assert image_store.bind_calls == [node_uid]
    assert bridge.note_calls == bridge.link_calls == 1
    node = graph.nodes[node_uid]
    assert node.properties.image_asset_uid.value == ASSET_UID
    assert node.properties.generated_image_generation_uid.value == GENERATION_UID
    assert node.properties.generated_image_generator_node_uid.value == GENERATOR_UID
    assert node.parent_id == graph.nodes[GENERATOR_UID].parent_id
    assert node.properties.node_size.size.width == 420
    assert node.properties.node_size.size.height == 280
    assert node.properties.node_position.position.x == 380
    edge = graph.links[edge_uid]
    assert (edge.source, edge.target) == (GENERATOR_UID, node_uid)
    assert edge.parent_id == graph.nodes[GENERATOR_UID].parent_id


@pytest.mark.asyncio
async def test_concurrent_automatic_ensure_creates_only_one_node_and_edge() -> None:
    """A cross-worker-style writer lock leaves one canonical canvas pair."""
    service, image_store, graph, bridge = _service()

    first, second = await asyncio.gather(
        service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        ),
        service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        ),
    )

    assert first.output_node_uid == second.output_node_uid
    assert bridge.note_calls == bridge.link_calls == 1
    assert len(graph.nodes) == 2
    assert len(graph.links) == 1
    assert image_store.bind_calls == [first.output_node_uid]


@pytest.mark.asyncio
async def test_unbound_partial_node_is_reused_and_missing_edge_repaired() -> None:
    """A retry after edge failure adds only the missing canonical edge."""
    service, image_store, graph, bridge = _service()
    bridge.fail_links = True
    with pytest.raises(RuntimeError, match="synthetic link failure"):
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )
    assert canonical_result_node_uid(GENERATION_UID) in graph.nodes
    assert image_store.bind_calls == []

    bridge.fail_links = False
    outcome = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )

    assert outcome.created is True
    assert bridge.note_calls == 1
    assert bridge.link_calls == 2
    assert len(graph.nodes) == 2
    assert len(graph.links) == 1


@pytest.mark.asyncio
async def test_bind_failure_recovers_existing_canvas_objects_without_duplicates() -> None:
    """A PostgreSQL bind retry validates and reuses durable Qdrant objects."""
    service, image_store, graph, bridge = _service()
    image_store.bind_succeeds = False
    with pytest.raises(ImageResultNodeError) as failure:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )
    assert failure.value.code == "output_binding_conflict"

    image_store.bind_succeeds = True
    outcome = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )

    assert outcome.created is False
    assert len(graph.nodes) == 2
    assert len(graph.links) == 1
    assert bridge.note_calls == bridge.link_calls == 1


@pytest.mark.asyncio
async def test_bound_deleted_result_requires_explicit_recreate() -> None:
    """Automatic checks do not revive deletion; explicit recovery uses same IDs."""
    node_uid = canonical_result_node_uid(GENERATION_UID)
    service, image_store, graph, bridge = _service(_record(output_node_uid=node_uid))

    automatic = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )
    assert automatic.created is False
    assert node_uid not in graph.nodes
    assert bridge.note_calls == bridge.link_calls == 0
    assert image_store.bind_calls == []

    explicit = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=True,
    )
    assert explicit.output_node_uid == node_uid
    assert explicit.recreated is True
    assert node_uid in graph.nodes
    assert canonical_result_edge_uid(GENERATION_UID) in graph.links


@pytest.mark.asyncio
async def test_canonical_collision_fails_closed_without_overwrite() -> None:
    """Existing content under a canonical ID is never replaced."""
    service, image_store, graph, bridge = _service()
    node_uid = canonical_result_node_uid(GENERATION_UID)
    graph.nodes[node_uid] = Note(id=node_uid, graph_uid=BOARD_UID)

    with pytest.raises(ImageResultNodeError) as failure:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )

    assert failure.value.code == "canonical_collision"
    assert image_store.bind_calls == []
    assert bridge.note_calls == bridge.link_calls == 0


@pytest.mark.asyncio
async def test_missing_generation_asset_and_generator_fail_closed() -> None:
    """Authoritative missing associations fail before any canvas mutation."""
    service, image_store, graph, bridge = _service()
    image_store.record = None
    with pytest.raises(ImageResultNodeError) as missing_generation:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )
    assert missing_generation.value.code == "generation_not_found"

    image_store.record = _record(
        output_mime_type=None,
        output_width=None,
        output_height=None,
    )
    with pytest.raises(ImageResultNodeError) as missing_asset:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )
    assert missing_asset.value.code == "output_asset_unavailable"

    image_store.record = _record()
    graph.nodes.pop(GENERATOR_UID)
    with pytest.raises(ImageResultNodeError) as missing_generator:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )
    assert missing_generator.value.code == "generator_unavailable"
    assert bridge.note_calls == bridge.link_calls == 0


@pytest.mark.asyncio
async def test_wrong_generator_marker_and_edge_scope_are_rejected() -> None:
    """Generator identity and canonical edge folder scope are immutable."""
    service, image_store, graph, bridge = _service()
    graph.nodes[GENERATOR_UID] = Note(id=GENERATOR_UID, graph_uid=BOARD_UID)
    with pytest.raises(ImageResultNodeError) as wrong_marker:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )
    assert wrong_marker.value.code == "generator_unavailable"

    graph.nodes[GENERATOR_UID] = _generator().model_copy(update={"parent_id": "folder-1"})
    edge_uid = canonical_result_edge_uid(GENERATION_UID)
    graph.links[edge_uid] = Link(
        id=edge_uid,
        source=GENERATOR_UID,
        target=canonical_result_node_uid(GENERATION_UID),
        graph_uid=BOARD_UID,
        parent_id="folder-2",
    )
    with pytest.raises(ImageResultNodeError) as wrong_scope:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )
    assert wrong_scope.value.code == "canonical_collision"
    assert image_store.bind_calls == []
    assert bridge.note_calls == bridge.link_calls == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [GenerationStatus.STARTED, GenerationStatus.RETRYABLE, GenerationStatus.FAILED])
async def test_non_succeeded_generations_are_rejected(status: GenerationStatus) -> None:
    """No canvas result is created for a nonterminal or failed run."""
    service, image_store, _graph, bridge = _service(
        _record(
            status=status,
            output_asset_uid=None,
            output_mime_type=None,
            output_width=None,
            output_height=None,
        )
    )

    with pytest.raises(ImageResultNodeError) as failure:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )

    assert failure.value.code == "generation_not_succeeded"
    assert image_store.bind_calls == []
    assert bridge.note_calls == bridge.link_calls == 0
