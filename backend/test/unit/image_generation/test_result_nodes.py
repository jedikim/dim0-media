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
    canonical_result_batch_uid,
    canonical_result_edge_uid,
    canonical_result_node_uid,
)
from topix.store.image_generation import ImageGenerationOutputWriterBusyError

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
        self.writer_error: Exception | None = None
        self.lock = asyncio.Lock()

    @asynccontextmanager
    async def output_node_writer(self, *, board_uid: str, generation_uid: str):
        """Serialize fake preparation and finalization for one generation."""
        assert board_uid == BOARD_UID
        assert generation_uid == GENERATION_UID
        if self.writer_error is not None:
            raise self.writer_error
        async with self.lock:
            yield object(), self.record

    @asynccontextmanager
    async def output_node_transaction(self, *, board_uid: str, generation_uid: str, conn=None):
        """Yield the configured record on the fake writer connection."""
        assert board_uid == BOARD_UID
        assert generation_uid == GENERATION_UID
        assert conn is not None
        yield conn, self.record

    async def get_output_record(
        self,
        *,
        board_uid: str,
        generation_uid: str,
    ) -> ImageGenerationOutputRecord | None:
        """Return the configured record without taking the writer lock."""
        assert board_uid == BOARD_UID
        assert generation_uid == GENERATION_UID
        return self.record

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
        self.lock = asyncio.Lock()

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
        self.fail_oplog = False
        self.batch_ids: set[str] = set()
        self.batch_calls: list[tuple[str, Note, Link]] = []
        self.delivery_calls = 0

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

    async def persist_result_objects(
        self,
        *,
        board_id: str,
        note: Note | None,
        link: Link | None,
    ) -> None:
        """Persist only missing result objects without an early broadcast."""
        if note is not None:
            await self.add_notes(board_id=board_id, notes=[note])
        if link is not None:
            await self.add_links(board_id=board_id, links=[link])

    @asynccontextmanager
    async def result_delivery_order(self, *, board_id: str):
        """Serialize fake finalization like one live room lock."""
        assert board_id == BOARD_UID
        async with self.graph.lock:
            yield None

    async def ensure_result_batch(
        self,
        _conn,
        *,
        board_id: str,
        batch_id: str,
        note: Note,
        link: Link,
        generator: Note,
    ):
        """Record one deterministic combined result batch."""
        assert board_id == BOARD_UID
        assert generator.id == GENERATOR_UID
        if self.fail_oplog:
            raise RuntimeError("synthetic oplog failure")
        if batch_id in self.batch_ids:
            return None
        self.batch_ids.add(batch_id)
        self.batch_calls.append((batch_id, note, link))
        return object()

    async def deliver_result_batch(self, *, room, delivery) -> None:
        """Count committed fake deliveries only."""
        if delivery is not None:
            self.delivery_calls += 1


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
    batch_uid = canonical_result_batch_uid(
        GENERATION_UID,
        "2026-08-22T00:00:00",
        "2026-08-22T00:00:01",
    )
    assert batch_uid == canonical_result_batch_uid(
        GENERATION_UID,
        "2026-08-22T00:00:00",
        "2026-08-22T00:00:01",
    )
    assert batch_uid != canonical_result_batch_uid(
        GENERATION_UID,
        "2026-08-22T00:00:00",
        "2026-08-22T00:00:02",
    )
    assert batch_uid not in {node_uid, edge_uid}


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
    assert bridge.delivery_calls == 1
    assert len(bridge.batch_calls) == 1
    _, batch_node, batch_edge = bridge.batch_calls[0]
    assert batch_node.id == node_uid
    assert batch_edge.id == edge_uid
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
async def test_writer_contention_is_a_recoverable_materialization_race() -> None:
    """Translate bounded writer contention into the existing structured retry code."""
    service, image_store, _graph, _bridge = _service()
    image_store.writer_error = ImageGenerationOutputWriterBusyError("busy")

    with pytest.raises(ImageResultNodeError) as raced:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )

    assert raced.value.code == "materialization_raced"
    assert str(raced.value) == "Image result preparation overlapped with another operation. Please retry."


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
    assert sum(outcome.created for outcome in (first, second)) == 1
    assert not any(outcome.recreated for outcome in (first, second))
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
async def test_oplog_failure_leaves_qdrant_recoverable_without_binding() -> None:
    """A durable-batch failure is retried after deterministic Qdrant writes."""
    service, image_store, graph, bridge = _service()
    bridge.fail_oplog = True

    with pytest.raises(RuntimeError, match="synthetic oplog failure"):
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )

    assert canonical_result_node_uid(GENERATION_UID) in graph.nodes
    assert canonical_result_edge_uid(GENERATION_UID) in graph.links
    assert image_store.bind_calls == []
    assert bridge.delivery_calls == 0

    bridge.fail_oplog = False
    outcome = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )

    assert outcome.created is True
    assert image_store.bind_calls == [canonical_result_node_uid(GENERATION_UID)]
    assert len(bridge.batch_calls) == 1
    assert bridge.delivery_calls == 1


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
async def test_tombstoned_result_objects_are_absent_only_for_explicit_recreate() -> None:
    """Tombstones do not collide and are revived only through recreate intent."""
    node_uid = canonical_result_node_uid(GENERATION_UID)
    edge_uid = canonical_result_edge_uid(GENERATION_UID)
    service, image_store, graph, bridge = _service()
    await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )
    graph.nodes[node_uid] = graph.nodes[node_uid].model_copy(
        update={"deleted_at": "2026-08-22T00:00:00"},
    )
    graph.links[edge_uid] = graph.links[edge_uid].model_copy(
        update={"deleted_at": "2026-08-22T00:00:00"},
    )

    automatic = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )
    assert automatic.created is False
    assert graph.nodes[node_uid].deleted_at is not None

    explicit = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=True,
    )
    assert explicit.recreated is True
    assert graph.nodes[node_uid].deleted_at is None
    assert graph.links[edge_uid].deleted_at is None


@pytest.mark.asyncio
async def test_bound_partial_recreates_get_new_batches_and_truthful_outcomes() -> None:
    """Each node/edge rematerialization gets one batch and one truthful response."""
    service, image_store, graph, bridge = _service()
    initial = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )
    assert initial.created is True
    first_batch_uid = bridge.batch_calls[-1][0]
    node_uid = canonical_result_node_uid(GENERATION_UID)
    edge_uid = canonical_result_edge_uid(GENERATION_UID)
    original_node_created_at = graph.nodes[node_uid].created_at

    graph.links.pop(edge_uid)
    edge_only = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=True,
    )
    edge_batch_uid = bridge.batch_calls[-1][0]
    assert edge_only.created is edge_only.recreated is True
    assert edge_batch_uid != first_batch_uid
    assert graph.nodes[node_uid].created_at == original_node_created_at

    repeated = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=True,
    )
    assert repeated.created is repeated.recreated is False
    assert len(bridge.batch_calls) == 2

    graph.links[edge_uid] = graph.links[edge_uid].model_copy(
        update={"deleted_at": "2026-08-22T00:00:00"},
    )
    tombstone_edge = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=True,
    )
    tombstone_batch_uid = bridge.batch_calls[-1][0]
    assert tombstone_edge.created is tombstone_edge.recreated is True
    assert tombstone_batch_uid not in {first_batch_uid, edge_batch_uid}

    graph.nodes.pop(node_uid)
    node_only = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=True,
    )
    assert node_only.created is node_only.recreated is True
    assert bridge.batch_calls[-1][0] != tombstone_batch_uid
    assert len(graph.nodes) == 2
    assert len(graph.links) == 1


@pytest.mark.asyncio
async def test_concurrent_explicit_recreate_reports_one_durable_writer() -> None:
    """Concurrent explicit requests serialize before stale Qdrant preparation."""
    service, _image_store, graph, bridge = _service()
    await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )
    node_uid = canonical_result_node_uid(GENERATION_UID)
    edge_uid = canonical_result_edge_uid(GENERATION_UID)
    graph.nodes[node_uid] = graph.nodes[node_uid].model_copy(
        update={"deleted_at": "2026-08-22T00:00:00"},
    )
    graph.links[edge_uid] = graph.links[edge_uid].model_copy(
        update={"deleted_at": "2026-08-22T00:00:00"},
    )
    original_persist = bridge.persist_result_objects
    first_prepared = asyncio.Event()
    release_first = asyncio.Event()
    persist_calls = 0

    async def hold_first_persist(*, board_id: str, note: Note | None, link: Link | None) -> None:
        """Hold the first writer after prepare while the second waits for ownership."""
        nonlocal persist_calls
        await original_persist(board_id=board_id, note=note, link=link)
        persist_calls += 1
        if persist_calls == 1:
            first_prepared.set()
            await release_first.wait()

    bridge.persist_result_objects = hold_first_persist  # type: ignore[method-assign]
    first_task = asyncio.create_task(
        service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=True,
        )
    )
    await first_prepared.wait()
    second_task = asyncio.create_task(
        service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=True,
        )
    )
    await asyncio.sleep(0)
    assert persist_calls == 1
    release_first.set()
    first, second = await asyncio.gather(first_task, second_task)

    assert sum(outcome.created for outcome in (first, second)) == 1
    assert sum(outcome.recreated for outcome in (first, second)) == 1
    assert len(bridge.batch_calls) == 2
    assert persist_calls == 2
    assert graph.nodes[node_uid].deleted_at is None
    assert graph.links[edge_uid].deleted_at is None


@pytest.mark.asyncio
async def test_generator_folder_move_during_prepare_recovers_on_retry() -> None:
    """An unbound preparation race is reparented without resetting node placement."""
    service, _image_store, graph, bridge = _service()
    original_persist = bridge.persist_result_objects
    moved = False

    async def persist_then_move(*, board_id: str, note: Note | None, link: Link | None) -> None:
        """Move the generator after the first canonical Qdrant-equivalent write."""
        nonlocal moved
        await original_persist(board_id=board_id, note=note, link=link)
        if not moved:
            moved = True
            graph.nodes[GENERATOR_UID] = graph.nodes[GENERATOR_UID].model_copy(
                update={"parent_id": "folder-b"},
            )

    bridge.persist_result_objects = persist_then_move  # type: ignore[method-assign]
    with pytest.raises(ImageResultNodeError) as raced:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=False,
        )
    assert raced.value.code == "materialization_raced"
    assert bridge.batch_calls == []

    node_uid = canonical_result_node_uid(GENERATION_UID)
    edge_uid = canonical_result_edge_uid(GENERATION_UID)
    position = graph.nodes[node_uid].properties.node_position.model_copy(
        update={
            "position": graph.nodes[node_uid].properties.node_position.position.model_copy(
                update={"x": 999.0},
            )
        },
    )
    graph.nodes[node_uid] = graph.nodes[node_uid].model_copy(
        update={
            "properties": graph.nodes[node_uid].properties.model_copy(
                update={"node_position": position},
            )
        },
    )

    recovered = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )

    assert recovered.created is True
    assert graph.nodes[node_uid].parent_id == "folder-b"
    assert graph.links[edge_uid].parent_id == "folder-b"
    assert graph.nodes[node_uid].properties.node_position.position.x == 999.0
    assert len(bridge.batch_calls) == 1


@pytest.mark.asyncio
async def test_unbound_tombstones_materialize_without_explicit_recreate() -> None:
    """Unbound tombstones are partial state, while bound deletion stays opt-in."""
    service, image_store, graph, bridge = _service()
    await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )
    assert image_store.record is not None
    image_store.record = image_store.record.model_copy(update={"output_node_uid": None})
    bridge.batch_ids.clear()
    bridge.batch_calls.clear()
    node_uid = canonical_result_node_uid(GENERATION_UID)
    edge_uid = canonical_result_edge_uid(GENERATION_UID)
    graph.nodes[node_uid] = graph.nodes[node_uid].model_copy(
        update={"deleted_at": "2026-08-22T00:00:00"},
    )
    graph.links[edge_uid] = graph.links[edge_uid].model_copy(
        update={"deleted_at": "2026-08-22T00:00:00"},
    )

    recovered = await service.ensure_output_node(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
        recreate=False,
    )

    assert recovered.created is True
    assert graph.nodes[node_uid].deleted_at is None
    assert graph.links[edge_uid].deleted_at is None


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
    """Generator identity and bound canonical edge folder scope are immutable."""
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
    assert image_store.record is not None
    image_store.record = image_store.record.model_copy(
        update={"output_node_uid": canonical_result_node_uid(GENERATION_UID)},
    )
    with pytest.raises(ImageResultNodeError) as wrong_scope:
        await service.ensure_output_node(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
            recreate=True,
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
