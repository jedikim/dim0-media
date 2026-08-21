"""PostgreSQL-backed image-generation service integration tests."""

from __future__ import annotations

import asyncio
import json

from decimal import Decimal
from hashlib import sha256
from io import BytesIO
from unittest.mock import AsyncMock

import asyncpg
import pytest

from PIL import Image

from topix.image_generation.models import (
    GeneratedImagePayload,
    ImageAssetCreate,
    ImageAssetSource,
    ImageGenerationParameters,
    ImageProviderError,
    ImageStorageError,
    ProviderImageRequest,
    ProviderImageResult,
    ProviderUsage,
)
from topix.image_generation.service import ImageGenerationService
from topix.image_generation.storage import ImageStorage
from topix.image_generation.tasks import ImageGenerationTaskManager
from topix.store.image_generation import ImageGenerationStore
from topix.utils.common import gen_uid


def _image_bytes(color: str) -> bytes:
    """Create one small valid PNG for provider and asset fixtures."""
    output = BytesIO()
    Image.new("RGB", (12, 8), color=color).save(output, format="PNG")
    return output.getvalue()


def _result(content: bytes) -> ProviderImageResult:
    """Return one normalized successful provider result."""
    return ProviderImageResult(
        image=GeneratedImagePayload(
            mime_type="image/png",
            content=content,
            width=12,
            height=8,
            content_sha256=sha256(content).hexdigest(),
        ),
        provider_request_id="openrouter-generation-1",
        usage=ProviderUsage(input_units=5, output_units=7, total_units=12, generated_images=1),
        cost_usd=Decimal("0.025"),
    )


class _FakeAdapter:
    """Capture requests and return or raise one configured provider outcome."""

    provider_id = "openrouter"

    def __init__(self, outcome: ProviderImageResult | ImageProviderError) -> None:
        """Initialize the fake without any external client or credential."""
        self.outcome = outcome
        self.requests: list[ProviderImageRequest] = []

    async def generate(self, request: ProviderImageRequest) -> ProviderImageResult:
        """Record one request before returning the configured outcome."""
        self.requests.append(request)
        if isinstance(self.outcome, ImageProviderError):
            raise self.outcome
        return self.outcome


async def _create_user_and_board(conn: asyncpg.Connection) -> tuple[str, str]:
    """Insert one user and board into the disposable test schema."""
    user_uid = gen_uid()
    board_uid = gen_uid()
    await conn.execute(
        "INSERT INTO users (uid, email, username) VALUES ($1, $2, $3)",
        user_uid,
        f"{user_uid}@example.test",
        user_uid,
    )
    await conn.execute("INSERT INTO graphs (uid) VALUES ($1)", board_uid)
    return user_uid, board_uid


async def _service(
    pool: asyncpg.Pool,
    tmp_path,
    adapter: _FakeAdapter,
) -> tuple[ImageGenerationService, ImageGenerationStore, ImageGenerationTaskManager, ImageStorage]:
    """Build a service from real persistence/storage and a fake provider."""
    store = ImageGenerationStore()
    await store.open(pool)
    tasks = ImageGenerationTaskManager(concurrency=1)
    storage = ImageStorage(tmp_path)
    return (
        ImageGenerationService(store=store, adapter=adapter, storage=storage, tasks=tasks),
        store,
        tasks,
        storage,
    )


async def _add_reference(
    store: ImageGenerationStore,
    root,
    *,
    user_uid: str,
    board_uid: str,
    color: str,
) -> ImageAssetCreate:
    """Persist one internal reference file and its immutable metadata."""
    content = _image_bytes(color)
    asset_uid = gen_uid()
    storage_key = f"images/uploads/{asset_uid}.png"
    path = root / storage_key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    asset = ImageAssetCreate(
        uid=asset_uid,
        board_uid=board_uid,
        created_by_user_uid=user_uid,
        source_kind=ImageAssetSource.UPLOADED,
        storage_key=storage_key,
        mime_type="image/png",
        byte_size=len(content),
        width=12,
        height=8,
        content_sha256=sha256(content).hexdigest(),
    )
    await store.add_asset(asset)
    return asset


@pytest.mark.asyncio
async def test_t2i_success_persists_audit_output_usage_and_safe_content(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """A prompt-only job moves from durable started state to a verified asset."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    output = _image_bytes("green")
    adapter = _FakeAdapter(_result(output))
    service, _, tasks, _ = await _service(initialized_image_pg_pool, tmp_path, adapter)

    outcome = await service.start_generation(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Create a green teaching aid",
        parameters=ImageGenerationParameters(resolution="1K", quality="low"),
        reference_asset_uids=(),
        generator_node_uid=None,
    )
    assert outcome.status == "started"
    await tasks.wait()

    generation = await service.get_generation(board_uid=board_uid, generation_uid=outcome.generation_uid)
    assert generation is not None and generation.status == "succeeded"
    assert generation.output_asset_uid is not None
    delivered = await service.get_asset_content(board_uid=board_uid, asset_uid=generation.output_asset_uid)
    assert delivered is not None and delivered[1] == output
    async with initialized_image_pg_pool.acquire() as conn:
        attempt = await conn.fetchrow(
            "SELECT provider_request_id, usage, cost_usd, latency_ms FROM image_generation_attempt WHERE generation_uid = $1",
            outcome.generation_uid,
        )
    assert attempt is not None and attempt["provider_request_id"] == "openrouter-generation-1"
    usage = json.loads(attempt["usage"]) if isinstance(attempt["usage"], str) else dict(attempt["usage"])
    assert usage["total_units"] == 12
    assert attempt["cost_usd"] == Decimal("0.025")
    assert attempt["latency_ms"] >= 0
    assert len(adapter.requests) == 1 and adapter.requests[0].references == ()
    await tasks.close()


@pytest.mark.asyncio
async def test_ordered_i2i_concurrent_idempotency_schedules_one_provider_call(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """Equal concurrent I2I requests preserve order and schedule only the DB winner."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    adapter = _FakeAdapter(_result(_image_bytes("purple")))
    service, store, tasks, _ = await _service(initialized_image_pg_pool, tmp_path, adapter)
    first = await _add_reference(store, tmp_path, user_uid=user_uid, board_uid=board_uid, color="red")
    second = await _add_reference(store, tmp_path, user_uid=user_uid, board_uid=board_uid, color="blue")
    client_request_uid = gen_uid()

    async def start():
        """Submit one equal request to exercise the PostgreSQL unique constraint."""
        return await service.start_generation(
            user_uid=user_uid,
            board_uid=board_uid,
            client_request_uid=client_request_uid,
            model_id="x-ai/grok-imagine-image-2.0",
            prompt="Blend these references in their stated order",
            parameters=ImageGenerationParameters(),
            reference_asset_uids=(second.uid, first.uid),
            generator_node_uid=None,
        )

    outcomes = await asyncio.gather(start(), start())
    await tasks.wait()

    assert len({outcome.generation_uid for outcome in outcomes}) == 1
    assert len(adapter.requests) == 1
    assert [reference.asset_uid for reference in adapter.requests[0].references] == [second.uid, first.uid]
    async with initialized_image_pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT ordinal, asset_uid, reference_node_uid FROM image_generation_reference WHERE generation_uid = $1 ORDER BY ordinal",
            outcomes[0].generation_uid,
        )
    assert [(row["ordinal"], row["asset_uid"], row["reference_node_uid"]) for row in rows] == [
        (0, second.uid, None),
        (1, first.uid, None),
    ]
    await tasks.close()


@pytest.mark.asyncio
async def test_provider_failure_preserves_attempt_then_terminally_fails_run(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """PR-02 does not automatically retry an ambiguous provider timeout."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    adapter = _FakeAdapter(
        ImageProviderError(
            "provider_timeout",
            "The image provider timed out",
            provider_request_id="possibly-billed-request",
            cost_usd=Decimal("0.01"),
        )
    )
    service, _, tasks, _ = await _service(initialized_image_pg_pool, tmp_path, adapter)

    outcome = await service.start_generation(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        model_id="google/gemini-3-pro-image",
        prompt="Create a timeout audit fixture",
        parameters=ImageGenerationParameters(),
        reference_asset_uids=(),
        generator_node_uid=None,
    )
    await tasks.wait()

    async with initialized_image_pg_pool.acquire() as conn:
        run = await conn.fetchrow("SELECT status, error_code FROM image_generation_run WHERE uid = $1", outcome.generation_uid)
        attempt = await conn.fetchrow(
            "SELECT status, error_code, provider_request_id, cost_usd FROM image_generation_attempt WHERE generation_uid = $1",
            outcome.generation_uid,
        )
    assert run is not None and tuple(run.values()) == ("failed", "provider_timeout")
    assert attempt is not None and tuple(attempt.values()) == (
        "failed",
        "provider_timeout",
        "possibly-billed-request",
        Decimal("0.01"),
    )
    await tasks.close()


@pytest.mark.asyncio
async def test_file_is_removed_when_success_transaction_fails(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
    monkeypatch,
) -> None:
    """A persisted provider result is cleaned up before the run becomes failed."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    adapter = _FakeAdapter(_result(_image_bytes("orange")))
    service, store, tasks, _ = await _service(initialized_image_pg_pool, tmp_path, adapter)
    monkeypatch.setattr(store, "finish_succeeded", AsyncMock(side_effect=RuntimeError("unsafe database detail")))

    outcome = await service.start_generation(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Exercise post-write rollback cleanup",
        parameters=ImageGenerationParameters(),
        reference_asset_uids=(),
        generator_node_uid=None,
    )
    await tasks.wait()

    generation = await service.get_generation(board_uid=board_uid, generation_uid=outcome.generation_uid)
    assert generation is not None and generation.status == "failed"
    assert generation.error_code == "result_persist_failed"
    assert not list(tmp_path.glob("images/generated/**/*.png"))
    await tasks.close()


@pytest.mark.asyncio
async def test_storage_failure_becomes_sanitized_terminal_failure(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
    monkeypatch,
) -> None:
    """A safe storage error never creates an output asset or leaks a local path."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    adapter = _FakeAdapter(_result(_image_bytes("yellow")))
    service, _, tasks, storage = await _service(initialized_image_pg_pool, tmp_path, adapter)
    monkeypatch.setattr(storage, "write_generated", AsyncMock(side_effect=ImageStorageError("unsafe /local/path")))

    outcome = await service.start_generation(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Exercise storage failure handling",
        parameters=ImageGenerationParameters(),
        reference_asset_uids=(),
        generator_node_uid=None,
    )
    await tasks.wait()

    generation = await service.get_generation(board_uid=board_uid, generation_uid=outcome.generation_uid)
    assert generation is not None and generation.status == "failed"
    assert generation.error_code == "result_persist_failed"
    assert "/local/path" not in (generation.error_message or "")
    await tasks.close()
