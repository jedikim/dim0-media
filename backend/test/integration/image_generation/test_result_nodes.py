"""PostgreSQL and Qdrant integration for generated-image result nodes."""

from __future__ import annotations

import asyncio
import json
import logging
import os

from contextlib import asynccontextmanager
from hashlib import sha256

import asyncpg
import pytest
import pytest_asyncio

from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis

from topix.api.router.collab import _handle_message
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
from topix.store import image_generation as image_generation_store_module
from topix.store.collab_oplog import SEQ_KEY_PREFIX, CollabOplogStore
from topix.store.graph import GraphStore
from topix.store.image_generation import ImageGenerationOutputWriterBusyError, ImageGenerationStore
from topix.store.postgres.image_generation import (
    release_image_generation_output_writer,
    try_acquire_image_generation_output_writer,
)
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
        self.json_frames: list[dict] = []

    async def send_text(self, frame: str) -> None:
        """Record one peer-op frame."""
        self.frames.append(frame)

    async def send_json(self, frame: dict) -> None:
        """Record one acknowledgement frame from the WebSocket path."""
        self.json_frames.append(frame)


class _BlockingRecordingSocket(_RecordingSocket):
    """Pause result delivery so tests can inspect released database ownership."""

    def __init__(self) -> None:
        """Initialize delivery boundary events and frame storage."""
        super().__init__()
        self.delivery_started = asyncio.Event()
        self.release_delivery = asyncio.Event()

    async def send_text(self, frame: str) -> None:
        """Hold one live delivery until the test releases its room lock."""
        self.delivery_started.set()
        await self.release_delivery.wait()
        await super().send_text(frame)


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


@pytest_asyncio.fixture(loop_scope="function")
async def two_connection_result_pool(
    config: Config,
    initialized_image_pg_pool: asyncpg.Pool,
):
    """Yield two real connections confined to the disposable test schema."""
    async with initialized_image_pg_pool.acquire() as conn:
        schema_name = await conn.fetchval("SELECT current_schema()")

    async def initialize_connection(conn: asyncpg.Connection) -> None:
        """Point every competing connection at the existing disposable schema."""
        await conn.execute("SELECT set_config('search_path', $1, false)", schema_name)

    pool = await asyncpg.create_pool(
        config.run.databases.postgres.dsn(),
        min_size=2,
        max_size=2,
        setup=initialize_connection,
    )
    try:
        yield pool
    finally:
        await pool.close()


@pytest.mark.asyncio(loop_scope="function")
async def test_output_writer_lock_releases_and_does_not_serialize_other_generations(
    two_connection_result_pool: asyncpg.Pool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Bounded session ownership releases connections, errors, and cancellation."""
    monkeypatch.setattr(image_generation_store_module, "OUTPUT_NODE_WRITER_WAIT_SECONDS", 0.2)
    monkeypatch.setattr(image_generation_store_module, "OUTPUT_NODE_WRITER_RETRY_SECONDS", 0.1)
    real_try_lock = image_generation_store_module.try_acquire_image_generation_output_writer
    failed_try = asyncio.Event()

    async def observe_try_lock(conn: asyncpg.Connection, *, generation_uid: str) -> bool:
        """Expose the first failed try after its connection can return to the pool."""
        acquired = await real_try_lock(conn, generation_uid=generation_uid)
        if not acquired:
            failed_try.set()
        return acquired

    monkeypatch.setattr(
        image_generation_store_module,
        "try_acquire_image_generation_output_writer",
        observe_try_lock,
    )
    first_store = ImageGenerationStore()
    second_store = ImageGenerationStore()
    await first_store.open(two_connection_result_pool)
    await second_store.open(two_connection_result_pool)
    board_uid = gen_uid()
    generation_uid = gen_uid()
    other_generation_uid = gen_uid()
    first_entered = asyncio.Event()
    release_first = asyncio.Event()
    same_generation_entered = asyncio.Event()
    other_generation_entered = asyncio.Event()

    async def hold_first() -> None:
        """Hold one session lock while competing ownership is observed."""
        async with first_store.output_node_writer(
            board_uid=board_uid,
            generation_uid=generation_uid,
        ):
            first_entered.set()
            await release_first.wait()

    async def enter_same_generation() -> None:
        """Record entry only after the first generation owner releases."""
        await first_entered.wait()
        async with second_store.output_node_writer(
            board_uid=board_uid,
            generation_uid=generation_uid,
        ):
            same_generation_entered.set()

    async def enter_other_generation() -> None:
        """Use a distinct key without waiting for the first generation."""
        await first_entered.wait()
        async with second_store.output_node_writer(
            board_uid=board_uid,
            generation_uid=other_generation_uid,
        ):
            other_generation_entered.set()

    first_task = asyncio.create_task(hold_first())
    same_task = asyncio.create_task(enter_same_generation())
    await first_entered.wait()
    await asyncio.wait_for(failed_try.wait(), timeout=1)
    assert not same_generation_entered.is_set()
    async with two_connection_result_pool.acquire(timeout=0.05) as available_conn:
        assert await available_conn.fetchval("SELECT 1") == 1
    same_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await same_task

    failed_try.clear()
    started_at = asyncio.get_running_loop().time()
    with pytest.raises(ImageGenerationOutputWriterBusyError):
        async with second_store.output_node_writer(
            board_uid=board_uid,
            generation_uid=generation_uid,
        ):
            pytest.fail("contended writer unexpectedly acquired ownership")
    assert asyncio.get_running_loop().time() - started_at < 0.5

    other_task = asyncio.create_task(enter_other_generation())
    await asyncio.wait_for(other_generation_entered.wait(), timeout=1)
    await other_task

    first_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first_task
    async with asyncio.timeout(1):
        async with second_store.output_node_writer(
            board_uid=board_uid,
            generation_uid=generation_uid,
        ):
            pass

    with pytest.raises(RuntimeError, match="synthetic writer failure"):
        async with first_store.output_node_writer(
            board_uid=board_uid,
            generation_uid=generation_uid,
        ):
            raise RuntimeError("synthetic writer failure")
    async with asyncio.timeout(1):
        async with second_store.output_node_writer(
            board_uid=board_uid,
            generation_uid=generation_uid,
        ):
            pass


@pytest.mark.parametrize("anomaly", ["false", "error"])
@pytest.mark.asyncio(loop_scope="function")
async def test_output_writer_unlock_anomaly_preserves_body_error_and_pool_reentry(
    anomaly: str,
    initialized_image_pg_pool: asyncpg.Pool,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Cleanup anomalies keep the domain error while pool reset clears session locks."""
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation_uid = gen_uid()
    original = ImageResultNodeError(
        "materialization_raced",
        "Image result preparation overlapped with another operation. Please retry.",
    )
    real_release = image_generation_store_module.release_image_generation_output_writer

    async def anomalous_release(_conn: asyncpg.Connection, *, generation_uid: str) -> bool:
        """Leave cleanup to asyncpg reset while simulating one unlock anomaly."""
        assert generation_uid
        if anomaly == "error":
            raise RuntimeError("synthetic unlock failure")
        return False

    monkeypatch.setattr(
        image_generation_store_module,
        "release_image_generation_output_writer",
        anomalous_release,
    )
    with caplog.at_level(logging.ERROR), pytest.raises(ImageResultNodeError) as propagated:
        async with store.output_node_writer(
            board_uid=gen_uid(),
            generation_uid=generation_uid,
        ):
            raise original

    assert propagated.value is original
    assert propagated.value.code == "materialization_raced"
    assert "Please retry" not in caplog.text
    assert any(
        record.getMessage()
        in {
            "Image generation output writer lock was not held",
            "Image generation output writer unlock failed",
        }
        and getattr(record, "generation_uid", None) == generation_uid
        for record in caplog.records
    )

    monkeypatch.setattr(
        image_generation_store_module,
        "release_image_generation_output_writer",
        real_release,
    )
    async with asyncio.timeout(1):
        async with store.output_node_writer(
            board_uid=gen_uid(),
            generation_uid=generation_uid,
        ):
            pass


@pytest.mark.asyncio(loop_scope="function")
async def test_pool_release_fault_preserves_body_error_and_cancellation(
    config: Config,
    initialized_image_pg_pool: asyncpg.Pool,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A reset failure never replaces body failure or cancellation, and the pool recovers."""
    async with initialized_image_pg_pool.acquire() as conn:
        schema_name = await conn.fetchval("SELECT current_schema()")
    reset_failures: list[BaseException] = []

    async def initialize_connection(conn: asyncpg.Connection) -> None:
        """Keep every replacement connection inside the disposable schema."""
        await conn.execute("SELECT set_config('search_path', $1, false)", schema_name)

    async def fail_selected_reset(_conn: asyncpg.Connection) -> None:
        """Inject one reset timeout so asyncpg terminates the damaged connection."""
        if reset_failures:
            raise reset_failures.pop(0)

    pool = await asyncpg.create_pool(
        config.run.databases.postgres.dsn(),
        min_size=1,
        max_size=1,
        setup=initialize_connection,
        reset=fail_selected_reset,
    )
    store = ImageGenerationStore()
    await store.open(pool)
    generation_uid = gen_uid()
    original = ImageResultNodeError(
        "materialization_raced",
        "Image result preparation overlapped with another operation. Please retry.",
    )
    try:
        reset_failures.append(TimeoutError("private reset detail"))
        with caplog.at_level(logging.ERROR), pytest.raises(ImageResultNodeError) as propagated:
            async with store.output_node_writer(
                board_uid=gen_uid(),
                generation_uid=generation_uid,
            ):
                raise original

        assert propagated.value is original
        assert propagated.value.code == "materialization_raced"
        assert str(propagated.value) == str(original)
        assert "private reset detail" not in caplog.text
        assert any(
            record.getMessage() == "Image generation output writer connection release failed"
            and getattr(record, "generation_uid", None) == generation_uid
            and getattr(record, "release_error_type", None) == "TimeoutError"
            for record in caplog.records
        )
        async with asyncio.timeout(1):
            async with store.output_node_writer(
                board_uid=gen_uid(),
                generation_uid=generation_uid,
            ):
                pass

        caplog.clear()
        reset_failures.append(TimeoutError("private cancellation reset detail"))
        with caplog.at_level(logging.ERROR), pytest.raises(asyncio.CancelledError):
            async with store.output_node_writer(
                board_uid=gen_uid(),
                generation_uid=generation_uid,
            ):
                raise asyncio.CancelledError

        assert "private cancellation reset detail" not in caplog.text
        assert any(
            record.getMessage() == "Image generation output writer connection release failed"
            and getattr(record, "release_error_type", None) == "TimeoutError"
            for record in caplog.records
        )
        async with asyncio.timeout(1):
            async with store.output_node_writer(
                board_uid=gen_uid(),
                generation_uid=generation_uid,
            ):
                pass
    finally:
        await pool.close()


@pytest.mark.parametrize("starter", ["websocket", "output"])
@pytest.mark.asyncio(loop_scope="function")
async def test_live_room_and_single_connection_pool_follow_one_lock_order(
    starter: str,
    initialized_image_pg_pool: asyncpg.Pool,
    isolated_result_content_store: ContentStore,
    isolated_result_redis: RedisStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Room-first collaboration and result writes finish without a pool cycle."""
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
    await graph_store.add_notes(
        [
            Note(
                id=generator_uid,
                graph_uid=board_uid,
                properties=NoteProperties(image_prompt=TextProperty(text="lock order result")),
            )
        ]
    )
    generation, _asset = await _create_succeeded_generation(
        image_store,
        user_uid=user_uid,
        board_uid=board_uid,
        generator_uid=generator_uid,
        worker_uid=f"lock-order-{starter}",
    )
    oplog = CollabOplogStore(isolated_result_redis)
    await oplog.open(initialized_image_pg_pool)
    registry = RoomRegistry()
    socket = _BlockingRecordingSocket()
    room, client = await registry.join(
        board_uid,
        socket,  # type: ignore[arg-type]
        user_uid,
    )
    assert room is not None and client is not None
    bridge = AgentBoardBridge(graph_store=graph_store, registry=registry, oplog=oplog)
    service = ImageResultNodeService(
        image_store=image_store,
        graph_store=graph_store,
        bridge=bridge,
    )
    writer_entered = asyncio.Event()
    real_writer = image_store.output_node_writer

    @asynccontextmanager
    async def observe_writer(*, board_uid: str, generation_uid: str):
        """Expose entry only after the room-first service reaches DB ownership."""
        writer_entered.set()
        async with real_writer(
            board_uid=board_uid,
            generation_uid=generation_uid,
        ) as owned:
            yield owned

    monkeypatch.setattr(image_store, "output_node_writer", observe_writer)
    ws_before_db = asyncio.Event()
    release_ws = asyncio.Event()
    real_seq_for_batch = oplog.seq_for_batch

    async def gate_ws_before_db(board_id: str, batch_id: str, *, conn=None):
        """Hold a WebSocket operation after room acquisition but before its DB read."""
        ws_before_db.set()
        await release_ws.wait()
        return await real_seq_for_batch(board_id, batch_id, conn=conn)

    if starter == "websocket":
        monkeypatch.setattr(oplog, "seq_for_batch", gate_ws_before_db)
    ws_raw = json.dumps(
        {
            "kind": "op",
            "client_seq": 1,
            "batch": {"id": f"ws-lock-order-{starter}", "ops": []},
        }
    )

    async def run_ws_operation() -> None:
        """Run one real room-locked WebSocket collaboration operation."""
        await _handle_message(
            websocket=socket,  # type: ignore[arg-type]
            raw=ws_raw,
            graph_store=graph_store,
            oplog=oplog,
            room=room,
            client=client,
            board_id=board_uid,
            user_id=user_uid,
        )

    ws_task: asyncio.Task[None] | None = None
    result_task: asyncio.Task | None = None
    try:
        if starter == "websocket":
            ws_task = asyncio.create_task(run_ws_operation())
            await asyncio.wait_for(ws_before_db.wait(), timeout=1)
            result_task = asyncio.create_task(
                service.ensure_output_node(
                    board_uid=board_uid,
                    generation_uid=generation.uid,
                    recreate=False,
                )
            )
            await asyncio.sleep(0.05)
            assert not writer_entered.is_set()
            async with initialized_image_pg_pool.acquire(timeout=0.1) as available_conn:
                assert await available_conn.fetchval("SELECT 1") == 1
            release_ws.set()
            await asyncio.wait_for(ws_task, timeout=1)
        else:
            result_task = asyncio.create_task(
                service.ensure_output_node(
                    board_uid=board_uid,
                    generation_uid=generation.uid,
                    recreate=False,
                )
            )

        assert result_task is not None
        await asyncio.wait_for(writer_entered.wait(), timeout=1)
        await asyncio.wait_for(socket.delivery_started.wait(), timeout=1)
        if ws_task is None:
            ws_task = asyncio.create_task(run_ws_operation())
            await asyncio.sleep(0.05)
            assert not ws_task.done()

        async with initialized_image_pg_pool.acquire(timeout=0.1) as available_conn:
            assert await try_acquire_image_generation_output_writer(
                available_conn,
                generation_uid=generation.uid,
            )
            assert await release_image_generation_output_writer(
                available_conn,
                generation_uid=generation.uid,
            )
        socket.release_delivery.set()
        outcome, _ = await asyncio.wait_for(
            asyncio.gather(result_task, ws_task),
            timeout=2,
        )
    finally:
        release_ws.set()
        socket.release_delivery.set()
        for task in (result_task, ws_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (result_task, ws_task) if task is not None),
            return_exceptions=True,
        )

    node_uid = canonical_result_node_uid(generation.uid)
    edge_uid = canonical_result_edge_uid(generation.uid)
    assert outcome.created is True and outcome.recreated is False
    assert len(await graph_store.get_nodes([node_uid])) == 1
    assert len(await graph_store.get_links([edge_uid])) == 1
    batches = await oplog.batches_since(board_uid, 0)
    assert len(batches) == 2
    assert {batch["id"] for _seq, batch in batches} == {
        f"ws-lock-order-{starter}",
        canonical_result_batch_uid(
            generation.uid,
            (await graph_store.get_nodes([node_uid]))[0].created_at,
            (await graph_store.get_links([edge_uid]))[0].created_at,
        ),
    }
    assert len(socket.frames) == 1
    assert len(socket.json_frames) == 1
    assert registry.get(board_uid) is room and client.client_id in room.clients
    await oplog.close()
    await graph_store.close()


@pytest.mark.parametrize("deleted_scope", ["edge", "pair"])
@pytest.mark.asyncio(loop_scope="function")
async def test_cross_worker_explicit_recreate_serializes_adverse_interleaving(
    deleted_scope: str,
    two_connection_result_pool: asyncpg.Pool,
    isolated_result_content_store: ContentStore,
    isolated_result_redis: RedisStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A late cross-worker restore cannot overwrite or append a second batch."""
    user_uid = gen_uid()
    board_uid = gen_uid()
    generator_uid = gen_uid()
    async with two_connection_result_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (uid, email, username) VALUES ($1, $2, $3)",
            user_uid,
            f"{user_uid}@example.test",
            user_uid,
        )
        await conn.execute("INSERT INTO graphs (uid) VALUES ($1)", board_uid)

    first_image_store = ImageGenerationStore()
    second_image_store = ImageGenerationStore()
    await first_image_store.open(two_connection_result_pool)
    await second_image_store.open(two_connection_result_pool)
    monkeypatch.setattr(
        ContentStore,
        "from_config",
        classmethod(lambda _cls: isolated_result_content_store),
    )
    graph_store = GraphStore()
    await graph_store.open(two_connection_result_pool)
    await graph_store.add_notes(
        [
            Note(
                id=generator_uid,
                graph_uid=board_uid,
                properties=NoteProperties(image_prompt=TextProperty(text="cross-worker result")),
            )
        ]
    )
    generation, _asset = await _create_succeeded_generation(
        first_image_store,
        user_uid=user_uid,
        board_uid=board_uid,
        generator_uid=generator_uid,
        worker_uid=f"cross-worker-{deleted_scope}",
    )

    first_oplog = CollabOplogStore(isolated_result_redis)
    second_oplog = CollabOplogStore(isolated_result_redis)
    await first_oplog.open(two_connection_result_pool)
    await second_oplog.open(two_connection_result_pool)
    first_registry = RoomRegistry()
    second_registry = RoomRegistry()
    socket = _RecordingSocket()
    await first_registry.join(board_uid, socket, user_uid)  # type: ignore[arg-type]
    first_bridge = AgentBoardBridge(
        graph_store=graph_store,
        registry=first_registry,
        oplog=first_oplog,
    )
    second_bridge = AgentBoardBridge(
        graph_store=graph_store,
        registry=second_registry,
        oplog=second_oplog,
    )
    first_service = ImageResultNodeService(
        image_store=first_image_store,
        graph_store=graph_store,
        bridge=first_bridge,
    )
    second_service = ImageResultNodeService(
        image_store=second_image_store,
        graph_store=graph_store,
        bridge=second_bridge,
    )
    initial = await first_service.ensure_output_node(
        board_uid=board_uid,
        generation_uid=generation.uid,
        recreate=False,
    )
    assert initial.created is True
    node_uid = canonical_result_node_uid(generation.uid)
    edge_uid = canonical_result_edge_uid(generation.uid)
    live_node = (await graph_store.get_nodes([node_uid]))[0]
    live_edge = (await graph_store.get_links([edge_uid]))[0]
    tombstone_at = "2026-08-23T00:00:00"
    tombstones = [live_edge.model_copy(update={"deleted_at": tombstone_at}).model_dump(exclude_none=False)]
    if deleted_scope == "pair":
        tombstones.insert(
            0,
            live_node.model_copy(update={"deleted_at": tombstone_at}).model_dump(exclude_none=False),
        )
    await isolated_result_content_store.update_payload_only(tombstones)

    first_persisted = asyncio.Event()
    first_delivered = asyncio.Event()
    release_first_delivery = asyncio.Event()
    second_prepared = asyncio.Event()
    second_prepare_calls: list[tuple[Note | None, Link | None]] = []
    original_first_persist = first_bridge.persist_result_objects
    original_first_delivery = first_bridge.deliver_result_batch
    original_second_persist = second_bridge.persist_result_objects

    async def record_first_persist(*, board_id: str, note: Note | None, link: Link | None) -> None:
        """Expose the first authoritative Qdrant prepare boundary."""
        await original_first_persist(board_id=board_id, note=note, link=link)
        first_persisted.set()

    async def hold_after_first_delivery(*, room, delivery) -> None:
        """Block live delivery only after database writer ownership has ended."""
        await original_first_delivery(room=room, delivery=delivery)
        first_delivered.set()
        await release_first_delivery.wait()

    async def record_second_persist(*, board_id: str, note: Note | None, link: Link | None) -> None:
        """Prove the late writer never carries a stale object upsert."""
        second_prepare_calls.append((note, link))
        await original_second_persist(board_id=board_id, note=note, link=link)
        second_prepared.set()

    monkeypatch.setattr(first_bridge, "persist_result_objects", record_first_persist)
    monkeypatch.setattr(first_bridge, "deliver_result_batch", hold_after_first_delivery)
    monkeypatch.setattr(second_bridge, "persist_result_objects", record_second_persist)

    first_task = asyncio.create_task(
        first_service.ensure_output_node(
            board_uid=board_uid,
            generation_uid=generation.uid,
            recreate=True,
        )
    )
    await asyncio.wait_for(first_persisted.wait(), timeout=1)
    second_task = asyncio.create_task(
        second_service.ensure_output_node(
            board_uid=board_uid,
            generation_uid=generation.uid,
            recreate=True,
        )
    )
    await asyncio.wait_for(first_delivered.wait(), timeout=1)
    await asyncio.wait_for(second_prepared.wait(), timeout=1)
    second = await asyncio.wait_for(asyncio.shield(second_task), timeout=1)
    assert second_prepare_calls == [(None, None)]

    restored_node = (await graph_store.get_nodes([node_uid]))[0]
    moved_position = restored_node.properties.node_position.model_copy(
        update={
            "position": restored_node.properties.node_position.position.model_copy(
                update={"x": 777.0, "y": 333.0},
            )
        }
    )
    moved_size = restored_node.properties.node_size.model_copy(
        update={
            "size": restored_node.properties.node_size.size.model_copy(
                update={"width": 333.0, "height": 222.0},
            )
        }
    )
    await isolated_result_content_store.update_payload_only(
        [
            restored_node.model_copy(
                update={
                    "properties": restored_node.properties.model_copy(
                        update={"node_position": moved_position, "node_size": moved_size},
                    )
                }
            ).model_dump(exclude_none=False)
        ]
    )
    release_first_delivery.set()
    first = await asyncio.wait_for(first_task, timeout=1)

    assert sum(outcome.created for outcome in (first, second)) == 1
    assert sum(outcome.recreated for outcome in (first, second)) == 1
    final_nodes = await graph_store.get_nodes([node_uid])
    final_edges = await graph_store.get_links([edge_uid])
    assert len(final_nodes) == len(final_edges) == 1
    assert final_nodes[0].properties.node_position.position.model_dump() == {
        "x": 777.0,
        "y": 333.0,
    }
    assert final_nodes[0].properties.node_size.size.model_dump() == {
        "width": 333.0,
        "height": 222.0,
    }
    batches = await first_oplog.batches_since(board_uid, 0)
    assert len(batches) == 2
    recreation_batch = batches[-1][1]
    assert json.loads(socket.frames[-1])["batch"] == recreation_batch
    assert [op["type"] for op in recreation_batch["ops"]] == ["node.add", "edge.add"]
    assert [op["node"]["id"] for op in recreation_batch["ops"] if op["type"] == "node.add"] == [node_uid]
    assert [op["edge"]["id"] for op in recreation_batch["ops"] if op["type"] == "edge.add"] == [edge_uid]
    assert len(socket.frames) == 2

    await first_oplog.close()
    await second_oplog.close()
    await graph_store.close()


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
