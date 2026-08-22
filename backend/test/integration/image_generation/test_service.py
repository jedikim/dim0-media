"""PostgreSQL-backed image-generation service integration tests."""

from __future__ import annotations

import asyncio
import json

from datetime import UTC, datetime
from decimal import Decimal
from hashlib import sha256
from io import BytesIO
from unittest.mock import AsyncMock

import asyncpg
import pytest

from PIL import Image

from topix.image_generation.models import (
    MAX_PROVIDER_REFERENCE_IMAGE_BYTES,
    GeneratedImagePayload,
    ImageAssetCreate,
    ImageAssetRecord,
    ImageAssetSource,
    ImageGenerationParameters,
    ImageProviderError,
    ImageReferenceValidationError,
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
        ImageGenerationService(
            store=store,
            adapter=adapter,
            storage=storage,
            tasks=tasks,
            worker_uid="test-service-worker",
            lease_seconds=5.0,
            heartbeat_seconds=1.0,
        ),
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
    """The three-reference boundary preserves duplicates, order, and one DB winner."""
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
            reference_asset_uids=(second.uid, first.uid, second.uid),
            generator_node_uid=None,
        )

    outcomes = await asyncio.gather(start(), start())
    await tasks.wait()

    assert len({outcome.generation_uid for outcome in outcomes}) == 1
    assert len(adapter.requests) == 1
    assert [reference.asset_uid for reference in adapter.requests[0].references] == [
        second.uid,
        first.uid,
        second.uid,
    ]
    async with initialized_image_pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT ordinal, asset_uid, reference_node_uid FROM image_generation_reference WHERE generation_uid = $1 ORDER BY ordinal",
            outcomes[0].generation_uid,
        )
    assert [(row["ordinal"], row["asset_uid"], row["reference_node_uid"]) for row in rows] == [
        (0, second.uid, None),
        (1, first.uid, None),
        (2, second.uid, None),
    ]
    await tasks.close()


@pytest.mark.asyncio
async def test_oversized_reference_metadata_is_rejected_before_file_read_or_provider(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """Database metadata blocks oversized references before memory or provider work."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    adapter = _FakeAdapter(_result(_image_bytes("black")))
    service, store, tasks, _ = await _service(initialized_image_pg_pool, tmp_path, adapter)
    asset = ImageAssetCreate(
        board_uid=board_uid,
        created_by_user_uid=user_uid,
        source_kind=ImageAssetSource.UPLOADED,
        storage_key=f"images/uploads/{gen_uid()}.png",
        mime_type="image/png",
        byte_size=MAX_PROVIDER_REFERENCE_IMAGE_BYTES + 1,
        width=1,
        height=1,
        content_sha256="a" * 64,
    )
    await store.add_asset(asset)

    with pytest.raises(ImageReferenceValidationError) as exc_info:
        await service.start_generation(
            user_uid=user_uid,
            board_uid=board_uid,
            client_request_uid=gen_uid(),
            model_id="x-ai/grok-imagine-image-2.0",
            prompt="Reject before reading",
            parameters=ImageGenerationParameters(),
            reference_asset_uids=(asset.uid,),
            generator_node_uid=None,
        )
    assert exc_info.value.code == "reference_too_large"
    assert adapter.requests == []
    async with initialized_image_pg_pool.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM image_generation_run") == 0
    await tasks.close()


def test_reference_metadata_limit_failures_have_stable_codes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Format, pixel, aggregate, and encoded guards retain distinct API codes."""

    def asset(*, mime_type: str = "image/png", byte_size: int = 1, width: int = 1, height: int = 1) -> ImageAssetRecord:
        """Build one immutable metadata-only reference fixture."""
        return ImageAssetRecord(
            asset_uid=gen_uid(),
            board_uid=gen_uid(),
            created_by_user_uid=gen_uid(),
            source_kind=ImageAssetSource.UPLOADED,
            storage_key=f"images/uploads/{gen_uid()}.png",
            mime_type=mime_type,
            byte_size=byte_size,
            width=width,
            height=height,
            content_sha256="a" * 64,
            created_at=datetime.now(UTC),
        )

    with pytest.raises(ImageReferenceValidationError) as unsupported:
        ImageGenerationService._validate_reference_metadata(
            (asset(mime_type="image/gif"),),
            model_id="x-ai/grok-imagine-image-2.0",
            prompt="safe",
        )
    assert unsupported.value.code == "unsupported_reference_format"

    monkeypatch.setattr("topix.image_generation.service.MAX_GENERATED_IMAGE_PIXELS", 10)
    with pytest.raises(ImageReferenceValidationError) as pixels:
        ImageGenerationService._validate_reference_metadata(
            (asset(width=4, height=4),),
            model_id="x-ai/grok-imagine-image-2.0",
            prompt="safe",
        )
    assert pixels.value.code == "reference_pixel_limit_exceeded"

    monkeypatch.setattr("topix.image_generation.service.MAX_GENERATED_IMAGE_PIXELS", 40_000_000)
    monkeypatch.setattr("topix.image_generation.service.MAX_PROVIDER_REQUEST_BYTES", 10)
    with pytest.raises(ImageReferenceValidationError) as aggregate:
        ImageGenerationService._validate_reference_metadata(
            (asset(byte_size=6), asset(byte_size=6)),
            model_id="x-ai/grok-imagine-image-2.0",
            prompt="safe",
        )
    assert aggregate.value.code == "reference_request_too_large"

    monkeypatch.setattr("topix.image_generation.service.MAX_PROVIDER_REQUEST_BYTES", 20 * 1024 * 1024)
    monkeypatch.setattr("topix.image_generation.service.MAX_PROVIDER_ENCODED_REQUEST_BYTES", 1)
    with pytest.raises(ImageReferenceValidationError) as encoded:
        ImageGenerationService._validate_reference_metadata(
            (asset(),),
            model_id="x-ai/grok-imagine-image-2.0",
            prompt="safe",
        )
    assert encoded.value.code == "reference_encoded_size_exceeded"


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


@pytest.mark.asyncio
async def test_committed_success_is_preserved_after_ambiguous_database_response(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
    monkeypatch,
) -> None:
    """A commit-then-disconnect ambiguity never deletes the authoritative output."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    output = _image_bytes("teal")
    adapter = _FakeAdapter(_result(output))
    service, store, tasks, _ = await _service(initialized_image_pg_pool, tmp_path, adapter)
    real_finish = store.finish_succeeded

    async def commit_then_raise(**kwargs) -> None:
        """Commit through the real store, then simulate a lost database response."""
        await real_finish(**kwargs)
        raise RuntimeError("ambiguous database response")

    monkeypatch.setattr(store, "finish_succeeded", commit_then_raise)
    outcome = await service.start_generation(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Preserve a committed result",
        parameters=ImageGenerationParameters(),
        reference_asset_uids=(),
        generator_node_uid=None,
    )
    await tasks.wait()

    generation = await service.get_generation(board_uid=board_uid, generation_uid=outcome.generation_uid)
    assert generation is not None and generation.status == "succeeded"
    assert generation.output_asset_uid is not None
    delivered = await service.get_asset_content(board_uid=board_uid, asset_uid=generation.output_asset_uid)
    assert delivered is not None and delivered[1] == output
    assert len(list(tmp_path.glob("images/generated/**/*.png"))) == 1
    await tasks.close()


@pytest.mark.asyncio
async def test_uncertain_compensation_preserves_pending_file_until_reconciliation(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
    monkeypatch,
) -> None:
    """Unknown DB state keeps bytes and durable cleanup work for a later reconciler."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    output = _image_bytes("navy")
    adapter = _FakeAdapter(_result(output))
    service, store, tasks, _ = await _service(initialized_image_pg_pool, tmp_path, adapter)
    monkeypatch.setattr(store, "finish_succeeded", AsyncMock(side_effect=RuntimeError("database unavailable")))
    monkeypatch.setattr(store, "get_storage_state", AsyncMock(side_effect=RuntimeError("database unavailable")))

    outcome = await service.start_generation(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Retain uncertain output",
        parameters=ImageGenerationParameters(),
        reference_asset_uids=(),
        generator_node_uid=None,
    )
    await tasks.wait()
    generated_files = list(tmp_path.glob("images/generated/**/*.png"))
    assert len(generated_files) == 1
    async with initialized_image_pg_pool.acquire() as conn:
        pending = await conn.fetchrow(
            "SELECT status, pending_output_storage_key FROM image_generation_run WHERE uid = $1",
            outcome.generation_uid,
        )
        assert pending is not None and pending["status"] == "started"
        assert pending["pending_output_storage_key"] is not None
        await conn.execute(
            "UPDATE image_generation_run SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE uid = $1",
            outcome.generation_uid,
        )

    monkeypatch.undo()
    assert await service.reconcile_incomplete() == 1
    assert not generated_files[0].exists()
    async with initialized_image_pg_pool.acquire() as conn:
        reconciled = await conn.fetchrow(
            "SELECT status, pending_output_storage_key FROM image_generation_run WHERE uid = $1",
            outcome.generation_uid,
        )
    assert reconciled is not None and tuple(reconciled.values()) == ("failed", None)
    await tasks.close()


@pytest.mark.asyncio
async def test_failure_finalization_error_is_sanitized_and_reconciliable(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A DB error cannot replace or leak the original provider failure."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    adapter = _FakeAdapter(ImageProviderError("provider_rejected", "The provider rejected the request"))
    service, store, tasks, _ = await _service(initialized_image_pg_pool, tmp_path, adapter)
    sentinel = "unsafe-finalization-detail"
    monkeypatch.setattr(store, "finish_terminal_failed", AsyncMock(side_effect=RuntimeError(sentinel)))

    outcome = await service.start_generation(
        user_uid=user_uid,
        board_uid=board_uid,
        client_request_uid=gen_uid(),
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Keep failure handling safe",
        parameters=ImageGenerationParameters(),
        reference_asset_uids=(),
        generator_node_uid=None,
    )
    await tasks.wait()
    assert "RuntimeError" in caplog.text
    assert sentinel not in caplog.text
    async with initialized_image_pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT run.status, attempt.status AS attempt_status "
            "FROM image_generation_run AS run JOIN image_generation_attempt AS attempt "
            "ON attempt.generation_uid = run.uid WHERE run.uid = $1",
            outcome.generation_uid,
        )
    assert row is not None and tuple(row.values()) == ("started", "started")
    await tasks.close()
