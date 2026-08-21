"""Integration tests for generation audit transactions and state transitions."""

from __future__ import annotations

import json

from decimal import Decimal
from hashlib import sha256

import asyncpg
import pytest

from topix.image_generation.models import (
    GeneratedImagePayload,
    GenerationAttemptStart,
    GenerationReference,
    GenerationStart,
    ImageAssetCreate,
    ImageAssetResolutionError,
    ImageAssetSnapshot,
    ImageAssetSource,
    ImageProviderError,
    InvalidGenerationTransition,
    ProviderImageResult,
    ProviderUsage,
)
from topix.store.image_generation import ImageGenerationStore
from topix.utils.common import gen_uid


async def _create_user_and_board(conn: asyncpg.Connection) -> tuple[str, str]:
    """Insert one user and board for an isolated store scenario."""
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


def _asset(
    *,
    user_uid: str,
    board_uid: str,
    content: bytes,
    source: ImageAssetSource,
) -> ImageAssetCreate:
    """Build valid immutable metadata for deterministic image bytes."""
    uid = gen_uid()
    return ImageAssetCreate(
        uid=uid,
        board_uid=board_uid,
        created_by_user_uid=user_uid,
        source_kind=source,
        storage_key=f"images/{uid}.png",
        mime_type="image/png",
        byte_size=len(content),
        width=64,
        height=64,
        content_sha256=sha256(content).hexdigest(),
    )


def _provider_result(content: bytes) -> ProviderImageResult:
    """Build a successful normalized provider result for store tests."""
    return ProviderImageResult(
        image=GeneratedImagePayload(
            mime_type="image/png",
            content=content,
            width=64,
            height=64,
            content_sha256=sha256(content).hexdigest(),
        ),
        provider_request_id="provider-request-1",
        usage=ProviderUsage(input_units=10, output_units=20, total_units=30, generated_images=1),
        cost_usd=Decimal("0.0123456789"),
    )


@pytest.mark.asyncio
async def test_started_generation_preserves_ordered_asset_snapshot(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """Starting a run atomically records its attempt and immutable reference."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)

    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    reference_contents = (b"reference-one", b"reference-two")
    reference_assets = tuple(
        _asset(
            user_uid=user_uid,
            board_uid=board_uid,
            content=content,
            source=ImageAssetSource.UPLOADED,
        )
        for content in reference_contents
    )
    for asset in reference_assets:
        await store.add_asset(asset)
    generation = GenerationStart(
        user_uid=user_uid,
        board_uid=board_uid,
        generator_node_uid="generator-node-1",
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Create an image from the trusted reference",
        references=tuple(
            GenerationReference(
                ordinal=ordinal,
                reference_node_uid=None if ordinal == 0 else f"reference-node-{ordinal + 1}",
                asset_uid=asset.uid,
            )
            for ordinal, asset in enumerate(reference_assets)
        ),
    )

    await store.start_generation(generation)

    async with initialized_image_pg_pool.acquire() as conn:
        run = await conn.fetchrow("SELECT * FROM image_generation_run WHERE uid = $1", generation.uid)
        attempt = await conn.fetchrow("SELECT * FROM image_generation_attempt WHERE uid = $1", generation.attempt_uid)
        references = await conn.fetch(
            "SELECT * FROM image_generation_reference WHERE generation_uid = $1 ORDER BY ordinal",
            generation.uid,
        )

    assert run is not None and run["status"] == "started"
    assert attempt is not None and attempt["status"] == "started"
    assert [reference["ordinal"] for reference in references] == [0, 1]
    assert [reference["reference_node_uid"] for reference in references] == [None, "reference-node-2"]
    for reference, reference_asset, reference_content in zip(
        references,
        reference_assets,
        reference_contents,
        strict=True,
    ):
        raw_snapshot = reference["asset_snapshot"]
        snapshot = ImageAssetSnapshot.model_validate(json.loads(raw_snapshot) if isinstance(raw_snapshot, str) else raw_snapshot)
        assert snapshot.model_dump(mode="json") == {
            "asset_uid": reference_asset.uid,
            "source_kind": "uploaded",
            "storage_key": reference_asset.storage_key,
            "mime_type": "image/png",
            "byte_size": len(reference_content),
            "width": 64,
            "height": 64,
            "content_sha256": reference_asset.content_sha256,
        }


@pytest.mark.asyncio
async def test_success_is_atomic_and_terminal(initialized_image_pg_pool: asyncpg.Pool) -> None:
    """Success inserts its asset and prevents any later terminal overwrite."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation = GenerationStart(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="google/gemini-3-pro-image",
        prompt="Create a test result",
    )
    await store.start_generation(generation)

    output_content = b"generated-output"
    output_asset = _asset(
        user_uid=user_uid,
        board_uid=board_uid,
        content=output_content,
        source=ImageAssetSource.GENERATED,
    )
    await store.finish_succeeded(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        output_asset=output_asset,
        result=_provider_result(output_content),
        latency_ms=1234,
    )

    with pytest.raises(InvalidGenerationTransition):
        await store.finish_failed(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
        )

    async with initialized_image_pg_pool.acquire() as conn:
        run = await conn.fetchrow("SELECT * FROM image_generation_run WHERE uid = $1", generation.uid)
        attempt = await conn.fetchrow("SELECT * FROM image_generation_attempt WHERE uid = $1", generation.attempt_uid)
        asset_count = await conn.fetchval("SELECT count(*) FROM image_asset WHERE uid = $1", output_asset.uid)

    assert run is not None and run["status"] == "succeeded"
    assert run["output_asset_uid"] == output_asset.uid
    assert attempt is not None and attempt["status"] == "succeeded"
    assert attempt["provider_request_id"] == "provider-request-1"
    assert attempt["latency_ms"] == 1234
    assert asset_count == 1

    with pytest.raises(InvalidGenerationTransition):
        await store.finish_succeeded(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
            output_asset=output_asset,
            result=_provider_result(output_content),
            latency_ms=1500,
        )


@pytest.mark.asyncio
async def test_failure_is_atomic_and_rolls_back_late_success_asset(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """Failure remains terminal and a rejected success leaves no orphan DB asset."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation = GenerationStart(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="microsoft/mai-image-2.5-pro",
        prompt="Create a failure record",
    )
    await store.start_generation(generation)
    error = ImageProviderError(
        "provider_timeout",
        "The image provider timed out",
        provider_request_id="provider-request-timeout",
        usage=ProviderUsage(input_units=4),
        cost_usd=Decimal("0.001"),
    )
    await store.finish_attempt_failed(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        error=error,
        latency_ms=60000,
    )

    async with initialized_image_pg_pool.acquire() as conn:
        retryable_run = await conn.fetchrow("SELECT * FROM image_generation_run WHERE uid = $1", generation.uid)
        failed_attempt = await conn.fetchrow("SELECT * FROM image_generation_attempt WHERE uid = $1", generation.attempt_uid)
    assert retryable_run is not None and retryable_run["status"] == "retryable"
    assert retryable_run["completed_at"] is None and retryable_run["error_code"] is None
    assert failed_attempt is not None and failed_attempt["status"] == "failed"
    assert failed_attempt["error_code"] == "provider_timeout"

    await store.finish_failed(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
    )

    late_content = b"late-output"
    late_asset = _asset(
        user_uid=user_uid,
        board_uid=board_uid,
        content=late_content,
        source=ImageAssetSource.GENERATED,
    )
    with pytest.raises(InvalidGenerationTransition):
        await store.finish_succeeded(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
            output_asset=late_asset,
            result=_provider_result(late_content),
            latency_ms=61000,
        )

    async with initialized_image_pg_pool.acquire() as conn:
        run = await conn.fetchrow("SELECT * FROM image_generation_run WHERE uid = $1", generation.uid)
        attempt = await conn.fetchrow("SELECT * FROM image_generation_attempt WHERE uid = $1", generation.attempt_uid)
        late_asset_count = await conn.fetchval("SELECT count(*) FROM image_asset WHERE uid = $1", late_asset.uid)

    assert run is not None and run["status"] == "failed"
    assert run["error_code"] == "provider_timeout"
    assert attempt is not None and attempt["status"] == "failed"
    assert late_asset_count == 0

    with pytest.raises(InvalidGenerationTransition):
        await store.finish_failed(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
        )


@pytest.mark.asyncio
async def test_failed_attempt_is_preserved_before_second_attempt_succeeds(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """Attempt one may fail without preventing a separately audited retry success."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation = GenerationStart(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="google/gemini-3-pro-image",
        prompt="Retry this generation safely",
    )
    await store.start_generation(generation)
    await store.finish_attempt_failed(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        error=ImageProviderError("transient_timeout", "The provider timed out safely"),
        latency_ms=1000,
    )

    with pytest.raises(InvalidGenerationTransition):
        await store.start_attempt(
            GenerationAttemptStart(
                generation_uid=generation.uid,
                attempt_number=3,
                model_id=generation.model_id,
            )
        )

    retry = GenerationAttemptStart(
        generation_uid=generation.uid,
        attempt_number=2,
        provider="openrouter",
        model_id=generation.model_id,
    )
    await store.start_attempt(retry)
    output_content = b"retry-output"
    output_asset = _asset(
        user_uid=user_uid,
        board_uid=board_uid,
        content=output_content,
        source=ImageAssetSource.GENERATED,
    )
    await store.finish_succeeded(
        generation_uid=generation.uid,
        attempt_uid=retry.uid,
        output_asset=output_asset,
        result=_provider_result(output_content),
        latency_ms=800,
    )

    async with initialized_image_pg_pool.acquire() as conn:
        run = await conn.fetchrow("SELECT * FROM image_generation_run WHERE uid = $1", generation.uid)
        attempts = await conn.fetch(
            "SELECT uid, attempt_number, status, error_code FROM image_generation_attempt WHERE generation_uid = $1 ORDER BY attempt_number",
            generation.uid,
        )

    assert run is not None and run["status"] == "succeeded"
    assert run["error_code"] is None and run["output_asset_uid"] == output_asset.uid
    assert [(row["attempt_number"], row["status"]) for row in attempts] == [(1, "failed"), (2, "succeeded")]
    assert attempts[0]["uid"] == generation.attempt_uid
    assert attempts[0]["error_code"] == "transient_timeout"

    with pytest.raises(InvalidGenerationTransition):
        await store.start_attempt(
            GenerationAttemptStart(
                generation_uid=generation.uid,
                attempt_number=3,
                model_id=generation.model_id,
            )
        )


@pytest.mark.asyncio
async def test_cross_board_reference_rolls_back_started_records(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """A reference from another board aborts the entire start transaction."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, first_board_uid = await _create_user_and_board(conn)
        second_board_uid = gen_uid()
        await conn.execute("INSERT INTO graphs (uid) VALUES ($1)", second_board_uid)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    foreign_asset = _asset(
        user_uid=user_uid,
        board_uid=first_board_uid,
        content=b"foreign-reference",
        source=ImageAssetSource.UPLOADED,
    )
    await store.add_asset(foreign_asset)
    generation = GenerationStart(
        user_uid=user_uid,
        board_uid=second_board_uid,
        model_id="microsoft/mai-image-2.5-pro",
        prompt="Do not accept a foreign board reference",
        references=(GenerationReference(ordinal=0, reference_node_uid="foreign-node", asset_uid=foreign_asset.uid),),
    )

    with pytest.raises(ImageAssetResolutionError):
        await store.start_generation(generation)

    async with initialized_image_pg_pool.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM image_generation_run WHERE uid = $1", generation.uid) == 0
        assert await conn.fetchval("SELECT count(*) FROM image_generation_attempt WHERE uid = $1", generation.attempt_uid) == 0


@pytest.mark.asyncio
async def test_cross_board_output_rolls_back_asset_and_transition(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """A generated asset on another board cannot complete the run."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, first_board_uid = await _create_user_and_board(conn)
        second_board_uid = gen_uid()
        await conn.execute("INSERT INTO graphs (uid) VALUES ($1)", second_board_uid)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation = GenerationStart(
        user_uid=user_uid,
        board_uid=first_board_uid,
        model_id="google/gemini-3-pro-image",
        prompt="Keep the output on this board",
    )
    await store.start_generation(generation)
    content = b"wrong-board-output"
    wrong_board_asset = _asset(
        user_uid=user_uid,
        board_uid=second_board_uid,
        content=content,
        source=ImageAssetSource.GENERATED,
    )

    with pytest.raises(InvalidGenerationTransition):
        await store.finish_succeeded(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
            output_asset=wrong_board_asset,
            result=_provider_result(content),
            latency_ms=100,
        )

    async with initialized_image_pg_pool.acquire() as conn:
        status = await conn.fetchval("SELECT status FROM image_generation_run WHERE uid = $1", generation.uid)
        asset_count = await conn.fetchval("SELECT count(*) FROM image_asset WHERE uid = $1", wrong_board_asset.uid)
    assert status == "started"
    assert asset_count == 0
