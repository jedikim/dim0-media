"""Integration tests for generation audit transactions and state transitions."""

from __future__ import annotations

import asyncio
import json

from decimal import Decimal
from hashlib import sha256

import asyncpg
import pytest

from topix.image_generation.models import (
    GeneratedImagePayload,
    GenerationAttemptStart,
    GenerationIdempotencyConflictError,
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

WORKER_UID = "test-image-worker"


def _generation(**kwargs: object) -> GenerationStart:
    """Build a generation owned by one stable integration-test worker."""
    kwargs.setdefault("client_request_uid", gen_uid())
    kwargs.setdefault("worker_uid", WORKER_UID)
    return GenerationStart(**kwargs)


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
    storage_key = f"images/generated/{uid}/output.png" if source is ImageAssetSource.GENERATED else f"images/{uid}.png"
    return ImageAssetCreate(
        uid=uid,
        board_uid=board_uid,
        created_by_user_uid=user_uid,
        source_kind=source,
        storage_key=storage_key,
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
    generation = _generation(
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
    generation = _generation(
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
    assert await store.set_pending_output(
        generation_uid=generation.uid,
        worker_uid=WORKER_UID,
        storage_key=output_asset.storage_key,
    )
    await store.finish_succeeded(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        worker_uid=WORKER_UID,
        output_asset=output_asset,
        result=_provider_result(output_content),
        latency_ms=1234,
    )

    with pytest.raises(InvalidGenerationTransition):
        await store.finish_failed(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
            worker_uid=WORKER_UID,
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
            worker_uid=WORKER_UID,
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
    generation = _generation(
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
        worker_uid=WORKER_UID,
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
        worker_uid=WORKER_UID,
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
            worker_uid=WORKER_UID,
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
            worker_uid=WORKER_UID,
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
    generation = _generation(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="google/gemini-3-pro-image",
        prompt="Retry this generation safely",
    )
    await store.start_generation(generation)
    await store.finish_attempt_failed(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        worker_uid=WORKER_UID,
        error=ImageProviderError("transient_timeout", "The provider timed out safely"),
        latency_ms=1000,
    )

    with pytest.raises(InvalidGenerationTransition):
        await store.start_attempt(
            GenerationAttemptStart(
                generation_uid=generation.uid,
                worker_uid=WORKER_UID,
                attempt_number=3,
                model_id=generation.model_id,
            )
        )

    retry = GenerationAttemptStart(
        generation_uid=generation.uid,
        worker_uid=WORKER_UID,
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
    assert await store.set_pending_output(
        generation_uid=generation.uid,
        worker_uid=WORKER_UID,
        storage_key=output_asset.storage_key,
    )
    await store.finish_succeeded(
        generation_uid=generation.uid,
        attempt_uid=retry.uid,
        worker_uid=WORKER_UID,
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
                worker_uid=WORKER_UID,
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
    generation = _generation(
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
    generation = _generation(
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
    assert await store.set_pending_output(
        generation_uid=generation.uid,
        worker_uid=WORKER_UID,
        storage_key=wrong_board_asset.storage_key,
    )

    with pytest.raises(InvalidGenerationTransition):
        await store.finish_succeeded(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
            worker_uid=WORKER_UID,
            output_asset=wrong_board_asset,
            result=_provider_result(content),
            latency_ms=100,
        )

    async with initialized_image_pg_pool.acquire() as conn:
        status = await conn.fetchval("SELECT status FROM image_generation_run WHERE uid = $1", generation.uid)
        asset_count = await conn.fetchval("SELECT count(*) FROM image_asset WHERE uid = $1", wrong_board_asset.uid)
    assert status == "started"
    assert asset_count == 0


@pytest.mark.asyncio
async def test_idempotent_start_reuses_same_request_and_rejects_changed_content(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """PostgreSQL is the durable authority for equal and conflicting request IDs."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    client_request_uid = gen_uid()
    generation = _generation(
        client_request_uid=client_request_uid,
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Create one idempotent image",
    )

    first = await store.start_generation(generation)
    repeated = await store.start_generation(
        _generation(
            client_request_uid=client_request_uid,
            user_uid=user_uid,
            board_uid=board_uid,
            model_id=generation.model_id,
            prompt=generation.prompt,
        )
    )

    assert first.created is True
    assert repeated.created is False
    assert repeated.generation_uid == generation.uid
    with pytest.raises(GenerationIdempotencyConflictError):
        await store.start_generation(
            _generation(
                client_request_uid=client_request_uid,
                user_uid=user_uid,
                board_uid=board_uid,
                model_id=generation.model_id,
                prompt="Different billable content",
            )
        )


@pytest.mark.asyncio
async def test_concurrent_idempotent_starts_create_one_run_and_attempt(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """Two concurrent equal starts elect one durable generation and one provider attempt."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    client_request_uid = gen_uid()
    starts = tuple(
        _generation(
            client_request_uid=client_request_uid,
            user_uid=user_uid,
            board_uid=board_uid,
            model_id="google/gemini-3-pro-image",
            prompt="Create one concurrent image",
        )
        for _ in range(2)
    )

    outcomes = await asyncio.gather(*(store.start_generation(start) for start in starts))

    assert sum(outcome.created for outcome in outcomes) == 1
    assert len({outcome.generation_uid for outcome in outcomes}) == 1
    async with initialized_image_pg_pool.acquire() as conn:
        run_count = await conn.fetchval(
            "SELECT count(*) FROM image_generation_run WHERE user_uid = $1 AND board_uid = $2 AND client_request_uid = $3",
            user_uid,
            board_uid,
            client_request_uid,
        )
        attempt_count = await conn.fetchval(
            "SELECT count(*) FROM image_generation_attempt WHERE generation_uid = $1",
            outcomes[0].generation_uid,
        )
    assert run_count == 1
    assert attempt_count == 1


@pytest.mark.asyncio
async def test_reconciliation_fails_old_started_and_retryable_runs(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """Startup reconciliation closes abandoned work without inventing a retry."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    started = _generation(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Abandoned started work",
    )
    retryable = _generation(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="microsoft/mai-image-2.5-pro",
        prompt="Abandoned retryable work",
    )
    recent = _generation(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Recent work owned by another live process",
    )
    await store.start_generation(started)
    await store.start_generation(retryable)
    await store.start_generation(recent)
    await store.finish_attempt_failed(
        generation_uid=retryable.uid,
        attempt_uid=retryable.attempt_uid,
        worker_uid=WORKER_UID,
        error=ImageProviderError("provider_timeout", "The provider timed out"),
        latency_ms=100,
    )
    async with initialized_image_pg_pool.acquire() as conn:
        await conn.execute(
            "UPDATE image_generation_run SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE uid = ANY($1::text[])",
            [started.uid, retryable.uid],
        )

    reconciled = await store.reconcile_incomplete()

    assert reconciled == 2
    async with initialized_image_pg_pool.acquire() as conn:
        runs = await conn.fetch(
            "SELECT uid, status, error_code FROM image_generation_run WHERE uid = ANY($1::text[]) ORDER BY uid",
            [started.uid, retryable.uid],
        )
        started_attempt = await conn.fetchrow(
            "SELECT status, error_code FROM image_generation_attempt WHERE uid = $1",
            started.attempt_uid,
        )
        retryable_attempt = await conn.fetchrow(
            "SELECT status, error_code FROM image_generation_attempt WHERE uid = $1",
            retryable.attempt_uid,
        )
        recent_run = await conn.fetchrow(
            "SELECT status, error_code FROM image_generation_run WHERE uid = $1",
            recent.uid,
        )
    runs_by_uid = {row["uid"]: row for row in runs}
    assert (runs_by_uid[started.uid]["status"], runs_by_uid[started.uid]["error_code"]) == ("failed", "worker_lost")
    assert (runs_by_uid[retryable.uid]["status"], runs_by_uid[retryable.uid]["error_code"]) == (
        "failed",
        "provider_timeout",
    )
    assert started_attempt is not None and tuple(started_attempt.values()) == ("failed", "worker_lost")
    assert retryable_attempt is not None and tuple(retryable_attempt.values()) == ("failed", "provider_timeout")
    assert recent_run is not None and tuple(recent_run.values()) == ("started", None)


@pytest.mark.asyncio
async def test_concurrent_reconcilers_finalize_each_expired_run_once(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """The advisory lock serializes reconcilers across backend workers."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generations = tuple(
        _generation(
            user_uid=user_uid,
            board_uid=board_uid,
            model_id="x-ai/grok-imagine-image-2.0",
            prompt=f"Expired work {index}",
        )
        for index in range(3)
    )
    for generation in generations:
        await store.start_generation(generation)
    async with initialized_image_pg_pool.acquire() as conn:
        await conn.execute(
            "UPDATE image_generation_run SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE uid = ANY($1::text[])",
            [generation.uid for generation in generations],
        )

    counts = await asyncio.gather(store.reconcile_incomplete(), store.reconcile_incomplete())

    assert sum(counts) == len(generations)
    async with initialized_image_pg_pool.acquire() as conn:
        statuses = await conn.fetch(
            "SELECT run.status, attempt.status AS attempt_status "
            "FROM image_generation_run AS run JOIN image_generation_attempt AS attempt "
            "ON attempt.generation_uid = run.uid WHERE run.uid = ANY($1::text[])",
            [generation.uid for generation in generations],
        )
    assert {(row["status"], row["attempt_status"]) for row in statuses} == {("failed", "failed")}


@pytest.mark.asyncio
async def test_worker_ownership_rejects_late_completion_and_renews_only_owner(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """Only the active worker may extend or complete a live generation lease."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation = _generation(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="google/gemini-3-pro-image",
        prompt="Keep one authoritative owner",
    )
    await store.start_generation(generation, lease_seconds=5)
    assert not await store.renew_lease(
        generation_uid=generation.uid,
        worker_uid="foreign-worker",
        lease_seconds=30,
    )
    assert await store.renew_lease(
        generation_uid=generation.uid,
        worker_uid=WORKER_UID,
        lease_seconds=30,
    )

    output_content = b"late-foreign-output"
    output_asset = _asset(
        user_uid=user_uid,
        board_uid=board_uid,
        content=output_content,
        source=ImageAssetSource.GENERATED,
    )
    with pytest.raises(InvalidGenerationTransition):
        await store.finish_succeeded(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
            worker_uid="foreign-worker",
            output_asset=output_asset,
            result=_provider_result(output_content),
            latency_ms=10,
        )
    async with initialized_image_pg_pool.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM image_asset WHERE uid = $1", output_asset.uid) == 0


@pytest.mark.asyncio
async def test_terminal_failure_updates_attempt_and_run_once(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """The no-retry failure path atomically closes both audit records once."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation = _generation(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="microsoft/mai-image-2.5-pro",
        prompt="Fail atomically",
    )
    await store.start_generation(generation)
    error = ImageProviderError("provider_rejected", "The provider rejected the request")

    assert await store.finish_terminal_failed(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        worker_uid=WORKER_UID,
        error=error,
        latency_ms=25,
    )
    assert not await store.finish_terminal_failed(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        worker_uid=WORKER_UID,
        error=error,
        latency_ms=26,
    )
    async with initialized_image_pg_pool.acquire() as conn:
        values = await conn.fetchrow(
            "SELECT run.status, attempt.status AS attempt_status, run.error_code, attempt.error_code AS attempt_error "
            "FROM image_generation_run AS run JOIN image_generation_attempt AS attempt "
            "ON attempt.generation_uid = run.uid WHERE run.uid = $1",
            generation.uid,
        )
    assert values is not None and tuple(values.values()) == (
        "failed",
        "failed",
        "provider_rejected",
        "provider_rejected",
    )


@pytest.mark.asyncio
async def test_terminal_failure_rolls_back_attempt_when_run_update_fails(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """A run-update fault cannot commit only the attempt half of terminal failure."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation = _generation(
        user_uid=user_uid,
        board_uid=board_uid,
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Rollback both failure records",
    )
    await store.start_generation(generation)
    async with initialized_image_pg_pool.acquire() as conn:
        await conn.execute(
            "CREATE FUNCTION reject_generation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ "
            "BEGIN IF NEW.status = 'failed' THEN RAISE EXCEPTION 'injected run failure'; END IF; RETURN NEW; END $$;"
            "CREATE TRIGGER reject_generation_failure_trigger BEFORE UPDATE OF status ON image_generation_run "
            "FOR EACH ROW EXECUTE FUNCTION reject_generation_failure();"
        )

    with pytest.raises(asyncpg.RaiseError):
        await store.finish_terminal_failed(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
            worker_uid=WORKER_UID,
            error=ImageProviderError("provider_rejected", "The provider rejected the request"),
            latency_ms=25,
        )
    async with initialized_image_pg_pool.acquire() as conn:
        values = await conn.fetchrow(
            "SELECT run.status, attempt.status AS attempt_status, run.error_code, attempt.error_code AS attempt_error "
            "FROM image_generation_run AS run JOIN image_generation_attempt AS attempt "
            "ON attempt.generation_uid = run.uid WHERE run.uid = $1",
            generation.uid,
        )
    assert values is not None and tuple(values.values()) == ("started", "started", None, None)


@pytest.mark.asyncio
async def test_output_node_transaction_serializes_workers_and_binds_once(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """The PostgreSQL advisory lock serializes canvas writers across connections."""
    async with initialized_image_pg_pool.acquire() as conn:
        user_uid, board_uid = await _create_user_and_board(conn)
    store = ImageGenerationStore()
    await store.open(initialized_image_pg_pool)
    generation = _generation(
        user_uid=user_uid,
        board_uid=board_uid,
        generator_node_uid=gen_uid(),
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Create one canonical canvas result",
    )
    await store.start_generation(generation)
    content = b"canonical-output"
    output_asset = _asset(
        user_uid=user_uid,
        board_uid=board_uid,
        content=content,
        source=ImageAssetSource.GENERATED,
    )
    assert await store.set_pending_output(
        generation_uid=generation.uid,
        worker_uid=WORKER_UID,
        storage_key=output_asset.storage_key,
    )
    await store.finish_succeeded(
        generation_uid=generation.uid,
        attempt_uid=generation.attempt_uid,
        worker_uid=WORKER_UID,
        output_asset=output_asset,
        result=_provider_result(content),
        latency_ms=10,
    )

    first_entered = asyncio.Event()
    release_first = asyncio.Event()
    second_entered = asyncio.Event()
    node_uid = gen_uid()

    async def first_writer() -> None:
        """Hold the output transaction until the competing writer is waiting."""
        async with store.output_node_transaction(
            board_uid=board_uid,
            generation_uid=generation.uid,
        ) as (conn, record):
            assert record is not None and record.output_node_uid is None
            first_entered.set()
            await release_first.wait()
            assert await store.bind_output_node(
                conn,
                board_uid=board_uid,
                generation_uid=generation.uid,
                output_node_uid=node_uid,
            )

    async def second_writer() -> None:
        """Observe the committed canonical binding after advisory-lock handoff."""
        await first_entered.wait()
        async with store.output_node_transaction(
            board_uid=board_uid,
            generation_uid=generation.uid,
        ) as (_conn, record):
            assert record is not None and record.output_node_uid == node_uid
            second_entered.set()

    first_task = asyncio.create_task(first_writer())
    second_task = asyncio.create_task(second_writer())
    await first_entered.wait()
    await asyncio.sleep(0.05)
    assert not second_entered.is_set()
    release_first.set()
    await asyncio.gather(first_task, second_task)
    assert second_entered.is_set()

    async with store.output_node_transaction(
        board_uid=gen_uid(),
        generation_uid=generation.uid,
    ) as (_conn, foreign_record):
        assert foreign_record is None
