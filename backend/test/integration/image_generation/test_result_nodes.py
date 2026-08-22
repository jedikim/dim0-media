"""PostgreSQL and Qdrant integration for generated-image result nodes."""

from __future__ import annotations

import asyncio
import json
import os

from hashlib import sha256

import asyncpg
import pytest
import pytest_asyncio

from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis

from topix.collab.agent_bridge import AgentBoardBridge
from topix.collab.room import RoomRegistry
from topix.config.config import Config
from topix.datatypes.note.link import Link
from topix.datatypes.note.note import Note, NoteProperties
from topix.datatypes.property import TextProperty
from topix.image_generation.models import (
    GeneratedImagePayload,
    GenerationStart,
    ImageAssetCreate,
    ImageAssetSource,
    ProviderImageResult,
)
from topix.image_generation.result_nodes import (
    ImageResultNodeError,
    ImageResultNodeService,
    canonical_result_batch_uid,
    canonical_result_edge_uid,
    canonical_result_node_uid,
)
from topix.store.collab_oplog import SEQ_KEY_PREFIX, CollabOplogStore
from topix.store.graph import GraphStore
from topix.store.image_generation import ImageGenerationStore
from topix.store.qdrant.store import ContentStore
from topix.store.redis.store import RedisStore
from topix.utils.common import gen_uid

QDRANT_TEST_OPT_IN = "DIM0_IMAGE_GENERATION_QDRANT_TEST"
REDIS_TEST_OPT_IN = "DIM0_IMAGE_GENERATION_REDIS_TEST"


class _DeterministicEmbedder:
    """Provide local vectors so result-node tests never call an API."""

    dimensions = 4

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one zero vector for every local text input."""
        return [[0.0] * self.dimensions for _ in texts]


class _RecordingSocket:
    """Capture live peer frames without opening a network socket."""

    def __init__(self) -> None:
        """Initialize an empty outbound frame list."""
        self.frames: list[str] = []

    async def send_text(self, frame: str) -> None:
        """Record one peer-op frame."""
        self.frames.append(frame)


class _FailOnceOplog:
    """Inject one append failure before delegating to the real oplog."""

    def __init__(self, delegate: CollabOplogStore) -> None:
        """Wrap one real PostgreSQL/Redis-backed oplog."""
        self.delegate = delegate
        self.fail_append = True

    async def seq_for_batch(self, board_id: str, batch_id: str, *, conn):
        """Delegate deterministic batch lookup on the caller connection."""
        return await self.delegate.seq_for_batch(board_id, batch_id, conn=conn)

    async def next_seq(self, board_id: str, *, conn):
        """Delegate Redis sequence allocation with caller-connection seeding."""
        return await self.delegate.next_seq(board_id, conn=conn)

    async def append(self, board_id: str, seq: int, batch: dict, *, conn):
        """Fail once, then append through the real caller transaction."""
        if self.fail_append:
            self.fail_append = False
            raise RuntimeError("synthetic durable oplog failure")
        return await self.delegate.append(board_id, seq, batch, conn=conn)


async def _create_succeeded_generation(
    image_store: ImageGenerationStore,
    *,
    user_uid: str,
    board_uid: str,
    generator_uid: str,
    worker_uid: str,
) -> tuple[GenerationStart, ImageAssetCreate]:
    """Create one provider-free succeeded generation for result-node integration."""
    generation = GenerationStart(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        worker_uid=worker_uid,
        generator_node_uid=generator_uid,
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Create a local result fixture",
    )
    await image_store.start_generation(generation)
    content = f"local-result-{generation.uid}".encode()
    asset = ImageAssetCreate(
        board_uid=board_uid,
        created_by_user_uid=user_uid,
        source_kind=ImageAssetSource.GENERATED,
        storage_key=f"images/generated/{generation.uid}/output.png",
        mime_type="image/png",
        byte_size=len(content),
        width=320,
        height=160,
        content_sha256=sha256(content).hexdigest(),
    )
    assert await image_store.set_pending_output(
        generation_uid=generation.uid,
        worker_uid=worker_uid,
        storage_key=asset.storage_key,
    )
    await image_store.finish_succeeded(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        worker_uid=worker_uid,
        output_asset=asset,
        result=ProviderImageResult(
            image=GeneratedImagePayload(
                mime_type="image/png",
                content=content,
                width=320,
                height=160,
                content_sha256=asset.content_sha256,
            )
        ),
        latency_ms=1,
    )
    return generation, asset


@pytest_asyncio.fixture(loop_scope="function")
async def isolated_result_content_store(config: Config):
    """Yield a disposable Qdrant collection behind an explicit test opt-in."""
    if os.getenv(QDRANT_TEST_OPT_IN) != "1":
        raise RuntimeError(f"Result-node Qdrant tests require {QDRANT_TEST_OPT_IN}=1")
    qdrant = config.run.databases.qdrant
    client = AsyncQdrantClient(
        host=qdrant.host,
        port=qdrant.port,
        https=qdrant.https,
        api_key=qdrant.api_key.get_secret_value() if qdrant.api_key else None,
    )
    store = ContentStore(
        qdrant_client=client,
        embedder=_DeterministicEmbedder(),
        collection=f"test_image_result_{gen_uid()}",
    )
    await store.create_collection(quantized=False)
    try:
        yield store
    finally:
        cleanup_client = AsyncQdrantClient(
            host=qdrant.host,
            port=qdrant.port,
            https=qdrant.https,
            api_key=qdrant.api_key.get_secret_value() if qdrant.api_key else None,
        )
        try:
            if await cleanup_client.collection_exists(store.collection):
                await cleanup_client.delete_collection(store.collection)
        finally:
            await cleanup_client.close()
            await client.close()


@pytest_asyncio.fixture(loop_scope="function")
async def isolated_result_redis(config: Config):
    """Yield a test-only Redis store behind an explicit opt-in."""
    if os.getenv(REDIS_TEST_OPT_IN) != "1":
        raise RuntimeError(f"Result-node Redis tests require {REDIS_TEST_OPT_IN}=1")
    redis_config = config.run.databases.redis
    client = Redis(
        host=redis_config.host,
        port=redis_config.port,
        db=redis_config.db,
        password=redis_config.password.get_secret_value() if redis_config.password else None,
        decode_responses=True,
    )
    await client.ping()
    initial_sequence_keys = {str(key) async for key in client.scan_iter(match=f"{SEQ_KEY_PREFIX}*")}
    store = RedisStore(redis_client=client)
    try:
        yield store
    finally:
        current_sequence_keys = {str(key) async for key in client.scan_iter(match=f"{SEQ_KEY_PREFIX}*")}
        new_sequence_keys = current_sequence_keys - initial_sequence_keys
        if new_sequence_keys:
            await client.delete(*new_sequence_keys)
        await store.close()


@pytest.mark.asyncio(loop_scope="function")
async def test_result_nodes_round_trip_and_recover_across_postgres_qdrant(
    initialized_image_pg_pool: asyncpg.Pool,
    isolated_result_content_store: ContentStore,
    isolated_result_redis: RedisStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Canonical node/edge writes recover without duplicating audit or assets."""
    user_uid = gen_uid()
    board_uid = gen_uid()
    generator_uid = gen_uid()
    async with initialized_image_pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (uid, email, username) VALUES ($1, $2, $3)",
            user_uid,
            f"{user_uid}@example.test",
            user_uid,
        )
        await conn.execute("INSERT INTO graphs (uid) VALUES ($1)", board_uid)

    image_store = ImageGenerationStore()
    await image_store.open(initialized_image_pg_pool)
    monkeypatch.setattr(
        ContentStore,
        "from_config",
        classmethod(lambda _cls: isolated_result_content_store),
    )
    graph_store = GraphStore()
    await graph_store.open(initialized_image_pg_pool)
    generator = Note(
        id=generator_uid,
        graph_uid=board_uid,
        properties=NoteProperties(image_prompt=TextProperty(text="a local cyan square")),
    )
    await graph_store.add_notes([generator])

    generation, asset = await _create_succeeded_generation(
        image_store,
        user_uid=user_uid,
        board_uid=board_uid,
        generator_uid=generator_uid,
        worker_uid="result-node-test-worker",
    )

    oplog = CollabOplogStore(isolated_result_redis)
    await oplog.open(initialized_image_pg_pool)
    registry = RoomRegistry()
    socket = _RecordingSocket()
    await registry.join(
        board_uid,
        socket,  # type: ignore[arg-type]
        user_uid,
    )
    bridge = AgentBoardBridge(
        graph_store=graph_store,
        registry=registry,
        oplog=_FailOnceOplog(oplog),  # type: ignore[arg-type]
    )
    service = ImageResultNodeService(
        image_store=image_store,
        graph_store=graph_store,
        bridge=bridge,
    )
    with pytest.raises(RuntimeError, match="synthetic durable oplog failure"):
        await service.ensure_output_node(
            board_uid=board_uid,
            generation_uid=generation.uid,
            recreate=False,
        )
    node_uid = canonical_result_node_uid(generation.uid)
    edge_uid = canonical_result_edge_uid(generation.uid)
    assert len(await graph_store.get_nodes([node_uid])) == 1
    assert len(await graph_store.get_links([edge_uid])) == 1
    async with initialized_image_pg_pool.acquire() as conn:
        failed_state = await conn.fetchrow(
            "SELECT run.output_node_uid, "
            "(SELECT count(*) FROM board_oplog WHERE board_id = $2) AS batches "
            "FROM image_generation_run AS run WHERE run.uid = $1",
            generation.uid,
            board_uid,
        )
    assert failed_state is not None and tuple(failed_state.values()) == (None, 0)
    assert socket.frames == []

    first, repeated = await asyncio.wait_for(
        asyncio.gather(
            service.ensure_output_node(
                board_uid=board_uid,
                generation_uid=generation.uid,
                recreate=False,
            ),
            service.ensure_output_node(
                board_uid=board_uid,
                generation_uid=generation.uid,
                recreate=False,
            ),
        ),
        timeout=1,
    )
    assert first.output_node_uid == repeated.output_node_uid == node_uid
    nodes = await graph_store.get_nodes([node_uid])
    links = await graph_store.get_links([edge_uid])
    assert len(nodes) == len(links) == 1
    assert nodes[0].properties.image_asset_uid.value == asset.uid
    assert links[0].source == generator_uid and links[0].target == node_uid

    async with initialized_image_pg_pool.acquire() as conn:
        before = await conn.fetchrow(
            "SELECT "
            "(SELECT count(*) FROM image_generation_run WHERE uid = $1) AS runs, "
            "(SELECT count(*) FROM image_generation_attempt WHERE generation_uid = $1) AS attempts, "
            "(SELECT count(*) FROM image_asset WHERE uid = $2) AS assets, "
            "(SELECT output_node_uid FROM image_generation_run WHERE uid = $1) AS output_node_uid, "
            "(SELECT count(*) FROM board_oplog WHERE board_id = $3) AS batches",
            generation.uid,
            asset.uid,
            board_uid,
        )
    assert before is not None and tuple(before.values()) == (1, 1, 1, node_uid, 1)
    assert len(socket.frames) == 1
    assert '"type": "node.add"' in socket.frames[0]
    assert '"type": "edge.add"' in socket.frames[0]

    initial_batch_uid = canonical_result_batch_uid(
        generation.uid,
        nodes[0].created_at,
        links[0].created_at,
    )
    round_trip_node = (await graph_store.get_nodes([node_uid]))[0]
    round_trip_edge = (await graph_store.get_links([edge_uid]))[0]
    assert (
        canonical_result_batch_uid(
            generation.uid,
            round_trip_node.created_at,
            round_trip_edge.created_at,
        )
        == initial_batch_uid
    )

    await graph_store.delete_link(edge_uid)
    edge_only = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=generation.uid,
        recreate=True,
    )
    assert edge_only.created is edge_only.recreated is True
    edge_only_node = (await graph_store.get_nodes([node_uid]))[0]
    edge_only_edge = (await graph_store.get_links([edge_uid]))[0]
    edge_only_batch_uid = canonical_result_batch_uid(
        generation.uid,
        edge_only_node.created_at,
        edge_only_edge.created_at,
    )
    assert edge_only_batch_uid != initial_batch_uid
    assert edge_only_node.created_at == round_trip_node.created_at
    assert len(socket.frames) == 2
    edge_only_live_batch = json.loads(socket.frames[-1])["batch"]
    edge_only_catch_up = await oplog.batches_since(board_uid, 1)
    assert edge_only_catch_up[-1][1] == edge_only_live_batch
    assert [op["type"] for op in edge_only_live_batch["ops"]] == [
        "node.add",
        "edge.add",
    ]

    edge_only_repeated = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=generation.uid,
        recreate=True,
    )
    assert edge_only_repeated.created is edge_only_repeated.recreated is False
    assert len(socket.frames) == 2

    await isolated_result_content_store.update_payload_only(
        [
            edge_only_edge.model_copy(
                update={"deleted_at": "2026-08-22T00:00:00"},
            ).model_dump(exclude_none=False),
        ]
    )
    edge_tombstone = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=generation.uid,
        recreate=True,
    )
    assert edge_tombstone.created is edge_tombstone.recreated is True
    tombstone_edge = (await graph_store.get_links([edge_uid]))[0]
    assert canonical_result_batch_uid(
        generation.uid,
        edge_only_node.created_at,
        tombstone_edge.created_at,
    ) not in {initial_batch_uid, edge_only_batch_uid}
    assert len(socket.frames) == 3

    await graph_store.delete_link(edge_uid)
    await graph_store.delete_node(node_uid)
    automatic = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=generation.uid,
        recreate=False,
    )
    assert automatic.created is False
    assert await graph_store.get_nodes([node_uid]) == []

    restored = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=generation.uid,
        recreate=True,
    )
    assert restored.output_node_uid == node_uid and restored.recreated is True
    assert len(await graph_store.get_nodes([node_uid])) == 1
    assert len(await graph_store.get_links([edge_uid])) == 1

    restored_node = (await graph_store.get_nodes([node_uid]))[0]
    restored_edge = (await graph_store.get_links([edge_uid]))[0]
    await isolated_result_content_store.update_payload_only(
        [
            restored_node.model_copy(
                update={"deleted_at": "2026-08-22T00:00:00"},
            ).model_dump(exclude_none=False),
            restored_edge.model_copy(
                update={"deleted_at": "2026-08-22T00:00:00"},
            ).model_dump(exclude_none=False),
        ]
    )
    tombstone_automatic = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=generation.uid,
        recreate=False,
    )
    assert tombstone_automatic.created is False
    assert (await graph_store.get_nodes([node_uid]))[0].deleted_at is not None
    tombstone_restored = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=generation.uid,
        recreate=True,
    )
    assert tombstone_restored.recreated is True
    assert (await graph_store.get_nodes([node_uid]))[0].deleted_at is None
    assert (await graph_store.get_links([edge_uid]))[0].deleted_at is None
    async with initialized_image_pg_pool.acquire() as conn:
        after = await conn.fetchrow(
            "SELECT "
            "(SELECT count(*) FROM image_generation_run WHERE uid = $1), "
            "(SELECT count(*) FROM image_generation_attempt WHERE generation_uid = $1), "
            "(SELECT count(*) FROM image_asset WHERE uid = $2)",
            generation.uid,
            asset.uid,
        )
    assert after is not None and tuple(after.values()) == (1, 1, 1)

    rollback_generation, _rollback_asset = await _create_succeeded_generation(
        image_store,
        user_uid=user_uid,
        board_uid=board_uid,
        generator_uid=generator_uid,
        worker_uid="result-node-rollback-worker",
    )
    rollback_node_uid = canonical_result_node_uid(rollback_generation.uid)
    rollback_edge_uid = canonical_result_edge_uid(rollback_generation.uid)
    original_bind = image_store.bind_output_node
    fail_binding_once = True

    async def fail_after_real_append(
        conn,
        *,
        board_uid: str,
        generation_uid: str,
        output_node_uid: str,
    ) -> bool:
        """Fail after the real transactional append to prove rollback recovery."""
        nonlocal fail_binding_once
        if generation_uid == rollback_generation.uid and fail_binding_once:
            fail_binding_once = False
            raise RuntimeError("synthetic binding failure after append")
        return await original_bind(
            conn,
            board_uid=board_uid,
            generation_uid=generation_uid,
            output_node_uid=output_node_uid,
        )

    monkeypatch.setattr(image_store, "bind_output_node", fail_after_real_append)
    async with initialized_image_pg_pool.acquire() as conn:
        batches_before_rollback = await conn.fetchval(
            "SELECT count(*) FROM board_oplog WHERE board_id = $1",
            board_uid,
        )
    frames_before_rollback = len(socket.frames)
    with pytest.raises(RuntimeError, match="synthetic binding failure after append"):
        await service.ensure_output_node(
            board_uid=board_uid,
            generation_uid=rollback_generation.uid,
            recreate=False,
        )
    assert len(await graph_store.get_nodes([rollback_node_uid])) == 1
    assert len(await graph_store.get_links([rollback_edge_uid])) == 1
    async with initialized_image_pg_pool.acquire() as conn:
        rolled_back = await conn.fetchrow(
            "SELECT output_node_uid, (SELECT count(*) FROM board_oplog WHERE board_id = $2) AS batches FROM image_generation_run WHERE uid = $1",
            rollback_generation.uid,
            board_uid,
        )
    assert rolled_back is not None
    assert tuple(rolled_back.values()) == (None, batches_before_rollback)
    assert len(socket.frames) == frames_before_rollback

    rollback_recovered = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=rollback_generation.uid,
        recreate=False,
    )
    assert rollback_recovered.created is True
    async with initialized_image_pg_pool.acquire() as conn:
        recovered_state = await conn.fetchrow(
            "SELECT output_node_uid, (SELECT count(*) FROM board_oplog WHERE board_id = $2) AS batches FROM image_generation_run WHERE uid = $1",
            rollback_generation.uid,
            board_uid,
        )
    assert recovered_state is not None
    assert tuple(recovered_state.values()) == (
        rollback_node_uid,
        batches_before_rollback + 1,
    )
    assert len(socket.frames) == frames_before_rollback + 1
    rollback_repeated = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=rollback_generation.uid,
        recreate=False,
    )
    assert rollback_repeated.created is False

    race_generation, _race_asset = await _create_succeeded_generation(
        image_store,
        user_uid=user_uid,
        board_uid=board_uid,
        generator_uid=generator_uid,
        worker_uid="result-node-folder-race-worker",
    )
    race_node_uid = canonical_result_node_uid(race_generation.uid)
    race_edge_uid = canonical_result_edge_uid(race_generation.uid)
    original_persist = bridge.persist_result_objects
    moved_generator = False

    async def persist_then_move_generator(
        *,
        board_id: str,
        note: Note | None,
        link: Link | None,
    ) -> None:
        """Move the real Qdrant generator between preparation and final read."""
        nonlocal moved_generator
        await original_persist(board_id=board_id, note=note, link=link)
        if note is not None and note.id == race_node_uid and not moved_generator:
            moved_generator = True
            await graph_store.patch_note(
                generator_uid,
                {"parent_id": "folder-b"},
                user_uid=None,
            )

    monkeypatch.setattr(bridge, "persist_result_objects", persist_then_move_generator)
    with pytest.raises(ImageResultNodeError) as folder_race:
        await service.ensure_output_node(
            board_uid=board_uid,
            generation_uid=race_generation.uid,
            recreate=False,
        )
    assert folder_race.value.code == "materialization_raced"
    race_node = (await graph_store.get_nodes([race_node_uid]))[0]
    race_edge = (await graph_store.get_links([race_edge_uid]))[0]
    assert race_node.parent_id is None and race_edge.parent_id is None

    race_recovered = await service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=race_generation.uid,
        recreate=False,
    )
    assert race_recovered.created is True
    recovered_node = (await graph_store.get_nodes([race_node_uid]))[0]
    recovered_edge = (await graph_store.get_links([race_edge_uid]))[0]
    assert recovered_node.parent_id == recovered_edge.parent_id == "folder-b"
    assert canonical_result_batch_uid(
        race_generation.uid,
        recovered_node.created_at,
        recovered_edge.created_at,
    ) == canonical_result_batch_uid(
        race_generation.uid,
        (await graph_store.get_nodes([race_node_uid]))[0].created_at,
        (await graph_store.get_links([race_edge_uid]))[0].created_at,
    )

    await oplog.close()
    await graph_store.close()
