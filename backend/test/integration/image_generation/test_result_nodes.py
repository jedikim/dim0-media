"""PostgreSQL and Qdrant integration for generated-image result nodes."""

from __future__ import annotations

import asyncio
import os

from hashlib import sha256

import asyncpg
import pytest
import pytest_asyncio

from qdrant_client import AsyncQdrantClient

from topix.collab.agent_bridge import AgentBoardBridge
from topix.collab.room import RoomRegistry
from topix.config.config import Config
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
    ImageResultNodeService,
    canonical_result_edge_uid,
    canonical_result_node_uid,
)
from topix.store.graph import GraphStore
from topix.store.image_generation import ImageGenerationStore
from topix.store.qdrant.store import ContentStore
from topix.utils.common import gen_uid

QDRANT_TEST_OPT_IN = "DIM0_IMAGE_GENERATION_QDRANT_TEST"


class _DeterministicEmbedder:
    """Provide local vectors so result-node tests never call an API."""

    dimensions = 4

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one zero vector for every local text input."""
        return [[0.0] * self.dimensions for _ in texts]


class _UnusedOplog:
    """Fail if an empty room registry unexpectedly attempts a broadcast."""

    async def next_seq(self, _board_id: str) -> int:
        """Reject unexpected live-room work in this persistence test."""
        raise AssertionError("no room should request an oplog sequence")


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


@pytest.mark.asyncio(loop_scope="function")
async def test_result_nodes_round_trip_and_recover_across_postgres_qdrant(
    initialized_image_pg_pool: asyncpg.Pool,
    isolated_result_content_store: ContentStore,
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
    graph_store = GraphStore()
    graph_store._content_store = isolated_result_content_store
    await graph_store.open(initialized_image_pg_pool)
    generator = Note(
        id=generator_uid,
        graph_uid=board_uid,
        properties=NoteProperties(image_prompt=TextProperty(text="a local cyan square")),
    )
    await graph_store.add_notes([generator])

    generation = GenerationStart(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        worker_uid="result-node-test-worker",
        generator_node_uid=generator_uid,
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Create a local result fixture",
    )
    await image_store.start_generation(generation)
    content = b"local-result-bytes"
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
        worker_uid="result-node-test-worker",
        storage_key=asset.storage_key,
    )
    await image_store.finish_succeeded(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        worker_uid="result-node-test-worker",
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

    bridge = AgentBoardBridge(
        graph_store=graph_store,
        registry=RoomRegistry(),
        oplog=_UnusedOplog(),  # type: ignore[arg-type]
    )
    service = ImageResultNodeService(
        image_store=image_store,
        graph_store=graph_store,
        bridge=bridge,
    )
    first, repeated = await asyncio.gather(
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
    )
    node_uid = canonical_result_node_uid(generation.uid)
    edge_uid = canonical_result_edge_uid(generation.uid)
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
            "(SELECT output_node_uid FROM image_generation_run WHERE uid = $1) AS output_node_uid",
            generation.uid,
            asset.uid,
        )
    assert before is not None and tuple(before.values()) == (1, 1, 1, node_uid)

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
    await graph_store.close()
