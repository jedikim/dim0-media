"""PostgreSQL persistence for auditable image generation."""

from __future__ import annotations

import json

import asyncpg

from topix.image_generation.models import (
    GenerationAttemptStart,
    GenerationIdempotencyConflictError,
    GenerationStart,
    GenerationStartOutcome,
    GenerationStorageState,
    ImageAssetCreate,
    ImageAssetRecord,
    ImageAssetResolutionError,
    ImageAssetSource,
    ImageGenerationDetailsRecord,
    ImageGenerationOutputRecord,
    ImageGenerationRecord,
    ImageGenerationReferenceDetails,
    ImageProviderError,
    InvalidGenerationTransition,
    PendingOutputCleanup,
    ProviderImageResult,
)

_IMAGE_RECONCILE_ADVISORY_LOCK = 4_909_157_410_015_203_302
_OUTPUT_NODE_ADVISORY_SEED = 704_568_223


async def try_acquire_image_generation_output_writer(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
) -> bool:
    """Try to own one generation without parking a pooled connection."""
    return bool(
        await conn.fetchval(
            "SELECT pg_try_advisory_lock(hashtextextended($1, $2))",
            generation_uid,
            _OUTPUT_NODE_ADVISORY_SEED,
        )
    )


async def release_image_generation_output_writer(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
) -> bool:
    """Release a generation writer lock before its connection returns to the pool."""
    return bool(
        await conn.fetchval(
            "SELECT pg_advisory_unlock(hashtextextended($1, $2))",
            generation_uid,
            _OUTPUT_NODE_ADVISORY_SEED,
        )
    )


async def create_image_asset(conn: asyncpg.Connection, asset: ImageAssetCreate) -> None:
    """Register immutable metadata for one server-managed image asset."""
    await conn.execute(
        "INSERT INTO image_asset ("
        "uid, board_uid, created_by_user_uid, source_kind, storage_key, "
        "mime_type, byte_size, width, height, content_sha256"
        ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        asset.uid,
        asset.board_uid,
        asset.created_by_user_uid,
        asset.source_kind.value,
        asset.storage_key,
        asset.mime_type,
        asset.byte_size,
        asset.width,
        asset.height,
        asset.content_sha256,
    )


def _asset_record(row: asyncpg.Record) -> ImageAssetRecord:
    """Validate one database asset row against the trusted domain contract."""
    return ImageAssetRecord(
        asset_uid=row["uid"],
        board_uid=row["board_uid"],
        created_by_user_uid=row["created_by_user_uid"],
        source_kind=row["source_kind"],
        storage_key=row["storage_key"],
        mime_type=row["mime_type"],
        byte_size=row["byte_size"],
        width=row["width"],
        height=row["height"],
        content_sha256=row["content_sha256"],
        created_at=row["created_at"],
    )


async def get_image_assets(
    conn: asyncpg.Connection,
    *,
    board_uid: str,
    asset_uids: tuple[str, ...],
) -> tuple[ImageAssetRecord, ...]:
    """Resolve board-scoped asset metadata in caller-provided order."""
    if not asset_uids:
        return ()
    rows = await conn.fetch(
        "SELECT asset.* FROM unnest($2::text[]) WITH ORDINALITY "
        "AS requested(uid, ordinal) "
        "JOIN image_asset AS asset ON asset.uid = requested.uid AND asset.board_uid = $1 "
        "ORDER BY requested.ordinal",
        board_uid,
        list(asset_uids),
    )
    if len(rows) != len(asset_uids):
        raise ImageAssetResolutionError("One or more image assets are unavailable on this board")
    return tuple(_asset_record(row) for row in rows)


async def get_image_asset(
    conn: asyncpg.Connection,
    *,
    board_uid: str,
    asset_uid: str,
) -> ImageAssetRecord | None:
    """Return one board-scoped asset without exposing cross-board existence."""
    row = await conn.fetchrow(
        "SELECT * FROM image_asset WHERE uid = $1 AND board_uid = $2",
        asset_uid,
        board_uid,
    )
    return _asset_record(row) if row is not None else None


async def get_image_generation(
    conn: asyncpg.Connection,
    *,
    board_uid: str,
    generation_uid: str,
) -> ImageGenerationRecord | None:
    """Return safe board-scoped generation state for polling."""
    row = await conn.fetchrow(
        "SELECT uid, board_uid, model_id, status, generator_node_uid, "
        "output_node_uid, output_asset_uid, error_code, "
        "error_message, started_at, completed_at "
        "FROM image_generation_run WHERE uid = $1 AND board_uid = $2",
        generation_uid,
        board_uid,
    )
    return ImageGenerationRecord.model_validate(dict(row)) if row is not None else None


async def get_image_generation_details(
    conn: asyncpg.Connection,
    *,
    board_uid: str,
    generation_uid: str,
) -> ImageGenerationDetailsRecord | None:
    """Return board-scoped provenance without exposing storage metadata."""
    run = await conn.fetchrow(
        "SELECT uid AS generation_uid, board_uid, model_id, prompt, parameters FROM image_generation_run WHERE uid = $1 AND board_uid = $2",
        generation_uid,
        board_uid,
    )
    if run is None:
        return None
    rows = await conn.fetch(
        "SELECT ordinal, asset_uid, asset_snapshot ->> 'mime_type' AS mime_type, "
        "(asset_snapshot ->> 'width')::integer AS width, "
        "(asset_snapshot ->> 'height')::integer AS height "
        "FROM image_generation_reference "
        "WHERE generation_uid = $1 AND board_uid = $2 ORDER BY ordinal ASC",
        generation_uid,
        board_uid,
    )
    run_payload = dict(run)
    if isinstance(run_payload["parameters"], str):
        run_payload["parameters"] = json.loads(run_payload["parameters"])
    return ImageGenerationDetailsRecord(
        **run_payload,
        references=tuple(ImageGenerationReferenceDetails.model_validate(dict(row)) for row in rows),
    )


async def lock_image_generation_output(
    conn: asyncpg.Connection,
    *,
    board_uid: str,
    generation_uid: str,
) -> ImageGenerationOutputRecord | None:
    """Lock and return one generation's authoritative output association."""
    await conn.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, $2))",
        generation_uid,
        _OUTPUT_NODE_ADVISORY_SEED,
    )
    row = await conn.fetchrow(
        "SELECT run.uid AS generation_uid, run.board_uid, run.status, "
        "run.generator_node_uid, run.output_node_uid, run.output_asset_uid, "
        "asset.mime_type AS output_mime_type, asset.width AS output_width, "
        "asset.height AS output_height "
        "FROM image_generation_run AS run "
        "LEFT JOIN image_asset AS asset ON asset.uid = run.output_asset_uid "
        "AND asset.board_uid = run.board_uid "
        "WHERE run.uid = $1 AND run.board_uid = $2 FOR UPDATE OF run",
        generation_uid,
        board_uid,
    )
    return ImageGenerationOutputRecord.model_validate(dict(row)) if row is not None else None


async def get_image_generation_output(
    conn: asyncpg.Connection,
    *,
    board_uid: str,
    generation_uid: str,
) -> ImageGenerationOutputRecord | None:
    """Read one generation output association without taking the writer lock."""
    row = await conn.fetchrow(
        "SELECT run.uid AS generation_uid, run.board_uid, run.status, "
        "run.generator_node_uid, run.output_node_uid, run.output_asset_uid, "
        "asset.mime_type AS output_mime_type, asset.width AS output_width, "
        "asset.height AS output_height "
        "FROM image_generation_run AS run "
        "LEFT JOIN image_asset AS asset ON asset.uid = run.output_asset_uid "
        "AND asset.board_uid = run.board_uid "
        "WHERE run.uid = $1 AND run.board_uid = $2",
        generation_uid,
        board_uid,
    )
    return ImageGenerationOutputRecord.model_validate(dict(row)) if row is not None else None


async def bind_image_generation_output_node(
    conn: asyncpg.Connection,
    *,
    board_uid: str,
    generation_uid: str,
    output_node_uid: str,
) -> bool:
    """Bind a canonical node only after its node and edge are durable."""
    bound = await conn.fetchval(
        "UPDATE image_generation_run SET output_node_uid = $3 "
        "WHERE uid = $1 AND board_uid = $2 AND status = 'succeeded' "
        "AND output_asset_uid IS NOT NULL "
        "AND (output_node_uid IS NULL OR output_node_uid = $3) RETURNING uid",
        generation_uid,
        board_uid,
        output_node_uid,
    )
    return bound is not None


async def get_generation_storage_state(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    storage_key: str,
) -> GenerationStorageState | None:
    """Return authoritative completion and storage-reference state for compensation."""
    row = await conn.fetchrow(
        "SELECT run.status, output_asset.storage_key AS output_storage_key, "
        "run.pending_output_storage_key, "
        "EXISTS(SELECT 1 FROM image_asset AS referenced WHERE referenced.storage_key = $2) "
        "AS storage_key_referenced "
        "FROM image_generation_run AS run "
        "LEFT JOIN image_asset AS output_asset ON output_asset.uid = run.output_asset_uid "
        "WHERE run.uid = $1",
        generation_uid,
        storage_key,
    )
    return GenerationStorageState.model_validate(dict(row)) if row is not None else None


async def renew_image_generation_lease(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    worker_uid: str,
    lease_seconds: float,
) -> bool:
    """Extend one started run only while the same worker still owns it."""
    if lease_seconds <= 0:
        raise ValueError("lease_seconds must be positive")
    renewed = await conn.fetchval(
        "UPDATE image_generation_run SET lease_expires_at = NOW() + ($3 * INTERVAL '1 second') "
        "WHERE uid = $1 AND worker_uid = $2 AND status = 'started' RETURNING uid",
        generation_uid,
        worker_uid,
        lease_seconds,
    )
    return renewed is not None


async def set_generation_pending_output(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    worker_uid: str,
    storage_key: str,
) -> bool:
    """Durably record a deterministic output key before touching the filesystem."""
    updated = await conn.fetchval(
        "UPDATE image_generation_run SET pending_output_storage_key = $3 "
        "WHERE uid = $1 AND worker_uid = $2 AND status = 'started' "
        "AND (pending_output_storage_key IS NULL OR pending_output_storage_key = $3) RETURNING uid",
        generation_uid,
        worker_uid,
        storage_key,
    )
    return updated is not None


async def clear_generation_pending_output(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    storage_key: str,
) -> bool:
    """Clear durable cleanup work only for the exact processed storage key."""
    updated = await conn.fetchval(
        "UPDATE image_generation_run SET pending_output_storage_key = NULL WHERE uid = $1 AND pending_output_storage_key = $2 RETURNING uid",
        generation_uid,
        storage_key,
    )
    return updated is not None


async def list_generation_pending_outputs(conn: asyncpg.Connection) -> tuple[PendingOutputCleanup, ...]:
    """List failed-run files that still require idempotent storage cleanup."""
    rows = await conn.fetch(
        "SELECT uid AS generation_uid, pending_output_storage_key AS storage_key "
        "FROM image_generation_run WHERE status = 'failed' "
        "AND pending_output_storage_key IS NOT NULL ORDER BY completed_at"
    )
    return tuple(PendingOutputCleanup.model_validate(dict(row)) for row in rows)


async def reconcile_image_generations(
    conn: asyncpg.Connection,
) -> int:
    """Atomically fail only expired leases under one cluster-wide writer lock."""
    safe_message = "The image generation worker stopped before completion"
    async with conn.transaction():
        acquired = await conn.fetchval(
            "SELECT pg_try_advisory_xact_lock($1)",
            _IMAGE_RECONCILE_ADVISORY_LOCK,
        )
        if not acquired:
            return 0
        expired_rows = await conn.fetch(
            "SELECT uid FROM image_generation_run "
            "WHERE status IN ('started', 'retryable') "
            "AND lease_expires_at <= NOW() "
            "ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED"
        )
        generation_uids = [row["uid"] for row in expired_rows]
        if not generation_uids:
            return 0
        await conn.execute(
            "UPDATE image_generation_attempt AS attempt SET "
            "status = 'failed', error_code = 'worker_lost', error_message = $2, "
            "latency_ms = GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - attempt.started_at)) * 1000)::bigint), "
            "completed_at = NOW() "
            "WHERE generation_uid = ANY($1::text[]) AND status = 'started'",
            generation_uids,
            safe_message,
        )
        rows = await conn.fetch(
            "UPDATE image_generation_run AS run SET status = 'failed', "
            "error_code = COALESCE((SELECT latest.error_code FROM image_generation_attempt AS latest "
            "WHERE latest.generation_uid = run.uid AND latest.status = 'failed' "
            "ORDER BY latest.attempt_number DESC LIMIT 1), 'worker_lost'), "
            "error_message = COALESCE((SELECT latest.error_message FROM image_generation_attempt AS latest "
            "WHERE latest.generation_uid = run.uid AND latest.status = 'failed' "
            "ORDER BY latest.attempt_number DESC LIMIT 1), $2), "
            "lease_expires_at = NULL, completed_at = NOW() "
            "WHERE uid = ANY($1::text[]) AND status IN ('started', 'retryable') "
            "RETURNING uid",
            generation_uids,
            safe_message,
        )
    return len(rows)


async def start_image_generation(
    conn: asyncpg.Connection,
    generation: GenerationStart,
    *,
    lease_seconds: float,
) -> GenerationStartOutcome:
    """Atomically win or reuse a durable idempotent generation request."""
    if lease_seconds <= 0:
        raise ValueError("lease_seconds must be positive")
    parameters = json.dumps(generation.parameters.model_dump(mode="json", exclude_none=True))
    if generation.request_fingerprint is None:
        raise ValueError("GenerationStart must carry its canonical fingerprint")

    async with conn.transaction():
        inserted = await conn.fetchrow(
            "INSERT INTO image_generation_run ("
            "uid, user_uid, board_uid, client_request_uid, request_fingerprint, "
            "worker_uid, lease_expires_at, generator_node_uid, provider, model_id, prompt, parameters, status"
            ") VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 * INTERVAL '1 second'), "
            "$8, $9, $10, $11, $12::jsonb, 'started') "
            "ON CONFLICT (user_uid, board_uid, client_request_uid) DO NOTHING "
            "RETURNING uid, status",
            generation.uid,
            generation.user_uid,
            generation.board_uid,
            generation.client_request_uid,
            generation.request_fingerprint,
            generation.worker_uid,
            lease_seconds,
            generation.generator_node_uid,
            generation.provider,
            generation.model_id,
            generation.prompt,
            parameters,
        )
        if inserted is None:
            existing = await conn.fetchrow(
                "SELECT uid, status, request_fingerprint FROM image_generation_run "
                "WHERE user_uid = $1 AND board_uid = $2 AND client_request_uid = $3",
                generation.user_uid,
                generation.board_uid,
                generation.client_request_uid,
            )
            if existing is None:
                raise RuntimeError("Idempotent generation row disappeared after conflict")
            if existing["request_fingerprint"] != generation.request_fingerprint:
                raise GenerationIdempotencyConflictError("client_request_uid was already used for a different generation request")
            return GenerationStartOutcome(
                generation_uid=existing["uid"],
                status=existing["status"],
                created=False,
            )

        await conn.execute(
            "INSERT INTO image_generation_attempt ("
            "uid, generation_uid, attempt_number, provider, model_id, status"
            ") VALUES ($1, $2, $3, $4, $5, 'started')",
            generation.attempt_uid,
            generation.uid,
            generation.attempt_number,
            generation.provider,
            generation.model_id,
        )

        if generation.references:
            inserted_rows = await conn.fetch(
                "INSERT INTO image_generation_reference ("
                "generation_uid, board_uid, ordinal, reference_node_uid, asset_uid, asset_snapshot"
                ") "
                "SELECT $1, $2, reference.ordinal, reference.node_uid, asset.uid, "
                "jsonb_build_object("
                "'asset_uid', asset.uid, "
                "'source_kind', asset.source_kind, "
                "'storage_key', asset.storage_key, "
                "'mime_type', asset.mime_type, "
                "'byte_size', asset.byte_size, "
                "'width', asset.width, "
                "'height', asset.height, "
                "'content_sha256', asset.content_sha256"
                ") "
                "FROM unnest($3::integer[], $4::text[], $5::text[]) "
                "AS reference(ordinal, node_uid, asset_uid) "
                "JOIN image_asset AS asset "
                "ON asset.uid = reference.asset_uid AND asset.board_uid = $2 "
                "RETURNING asset_uid",
                generation.uid,
                generation.board_uid,
                [reference.ordinal for reference in generation.references],
                [reference.reference_node_uid for reference in generation.references],
                [reference.asset_uid for reference in generation.references],
            )
            if len(inserted_rows) != len(generation.references):
                resolved_uids = {row["asset_uid"] for row in inserted_rows}
                missing = next(reference.asset_uid for reference in generation.references if reference.asset_uid not in resolved_uids)
                raise ImageAssetResolutionError(f"Image asset {missing} is unavailable on board {generation.board_uid}")

        return GenerationStartOutcome(
            generation_uid=generation.uid,
            status="started",
            created=True,
        )


async def start_image_generation_attempt(
    conn: asyncpg.Connection,
    attempt: GenerationAttemptStart,
    *,
    lease_seconds: float,
) -> None:
    """Atomically reopen a retryable run and insert its next started attempt."""
    if lease_seconds <= 0:
        raise ValueError("lease_seconds must be positive")
    async with conn.transaction():
        run = await conn.fetchval(
            "UPDATE image_generation_run SET status = 'started', worker_uid = $3, "
            "lease_expires_at = NOW() + ($4 * INTERVAL '1 second') "
            "WHERE uid = $1 AND status = 'retryable' "
            "AND $2 = (SELECT MAX(existing.attempt_number) + 1 "
            "FROM image_generation_attempt AS existing WHERE existing.generation_uid = $1) "
            "RETURNING uid",
            attempt.generation_uid,
            attempt.attempt_number,
            attempt.worker_uid,
            lease_seconds,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {attempt.generation_uid} is not retryable at attempt {attempt.attempt_number}")
        await conn.execute(
            "INSERT INTO image_generation_attempt ("
            "uid, generation_uid, attempt_number, provider, model_id, status"
            ") VALUES ($1, $2, $3, $4, $5, 'started')",
            attempt.uid,
            attempt.generation_uid,
            attempt.attempt_number,
            attempt.provider,
            attempt.model_id,
        )


def _validate_output_asset(asset: ImageAssetCreate, result: ProviderImageResult) -> None:
    """Ensure persisted output metadata describes the provider result bytes."""
    image = result.image
    if asset.source_kind is not ImageAssetSource.GENERATED:
        raise ValueError("generation output assets must use source_kind=generated")
    if (
        asset.mime_type != image.mime_type
        or asset.byte_size != len(image.content)
        or asset.width != image.width
        or asset.height != image.height
        or asset.content_sha256 != image.content_sha256
    ):
        raise ValueError("output asset metadata does not match the generated image")


async def finish_image_generation_succeeded(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    attempt_uid: str,
    worker_uid: str,
    output_asset: ImageAssetCreate,
    result: ProviderImageResult,
    latency_ms: int,
) -> None:
    """Atomically register the output asset and finalize a started attempt."""
    if latency_ms < 0:
        raise ValueError("latency_ms must not be negative")
    _validate_output_asset(output_asset, result)
    usage = json.dumps(result.usage.model_dump(mode="json", exclude_none=True) if result.usage else {})

    async with conn.transaction():
        owned_run = await conn.fetchval(
            "SELECT uid FROM image_generation_run WHERE uid = $1 AND worker_uid = $2 AND status = 'started' FOR UPDATE",
            generation_uid,
            worker_uid,
        )
        if owned_run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not owned and started")
        attempt = await conn.fetchval(
            "UPDATE image_generation_attempt SET "
            "status = 'succeeded', provider_request_id = $3, usage = $4::jsonb, "
            "cost_usd = $5, latency_ms = $6, completed_at = NOW() "
            "WHERE uid = $2 AND generation_uid = $1 AND status = 'started' "
            "RETURNING uid",
            generation_uid,
            attempt_uid,
            result.provider_request_id,
            usage,
            result.cost_usd,
            latency_ms,
        )
        if attempt is None:
            raise InvalidGenerationTransition(f"Attempt {attempt_uid} is not a started attempt for generation {generation_uid}")

        await create_image_asset(conn, output_asset)
        run = await conn.fetchval(
            "UPDATE image_generation_run SET "
            "status = 'succeeded', output_asset_uid = $2, pending_output_storage_key = NULL, "
            "lease_expires_at = NULL, completed_at = NOW() "
            "WHERE uid = $1 AND board_uid = $3 AND worker_uid = $4 AND status = 'started' "
            "AND pending_output_storage_key = $5 "
            "RETURNING uid",
            generation_uid,
            output_asset.uid,
            output_asset.board_uid,
            worker_uid,
            output_asset.storage_key,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not started on the output asset board")


async def finish_image_generation_attempt_failed(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    attempt_uid: str,
    worker_uid: str,
    error: ImageProviderError,
    latency_ms: int,
) -> None:
    """Preserve a failed attempt and leave its logical run retryable."""
    if latency_ms < 0:
        raise ValueError("latency_ms must not be negative")
    usage = json.dumps(error.usage.model_dump(mode="json", exclude_none=True) if error.usage else {})

    async with conn.transaction():
        owned_run = await conn.fetchval(
            "SELECT uid FROM image_generation_run WHERE uid = $1 AND worker_uid = $2 AND status = 'started' FOR UPDATE",
            generation_uid,
            worker_uid,
        )
        if owned_run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not owned and started")
        attempt = await conn.fetchval(
            "UPDATE image_generation_attempt SET "
            "status = 'failed', provider_request_id = $3, usage = $4::jsonb, "
            "cost_usd = $5, latency_ms = $6, error_code = $7, error_message = $8, "
            "completed_at = NOW() "
            "WHERE uid = $2 AND generation_uid = $1 AND status = 'started' "
            "RETURNING uid",
            generation_uid,
            attempt_uid,
            error.provider_request_id,
            usage,
            error.cost_usd,
            latency_ms,
            error.code,
            error.safe_message,
        )
        if attempt is None:
            raise InvalidGenerationTransition(f"Attempt {attempt_uid} is not a started attempt for generation {generation_uid}")

        run = await conn.fetchval(
            "UPDATE image_generation_run SET status = 'retryable' WHERE uid = $1 AND worker_uid = $2 AND status = 'started' RETURNING uid",
            generation_uid,
            worker_uid,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not started")


async def finish_image_generation_failed(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    attempt_uid: str,
    worker_uid: str,
) -> None:
    """Finalize a retryable run using one preserved failed attempt."""
    async with conn.transaction():
        run = await conn.fetchval(
            "UPDATE image_generation_run AS run SET "
            "status = 'failed', error_code = attempt.error_code, "
            "error_message = attempt.error_message, lease_expires_at = NULL, completed_at = NOW() "
            "FROM image_generation_attempt AS attempt "
            "WHERE run.uid = $1 AND run.worker_uid = $3 AND run.status = 'retryable' "
            "AND attempt.uid = $2 AND attempt.generation_uid = run.uid "
            "AND attempt.status = 'failed' "
            "AND attempt.attempt_number = ("
            "SELECT MAX(latest.attempt_number) FROM image_generation_attempt AS latest "
            "WHERE latest.generation_uid = run.uid"
            ") "
            "RETURNING run.uid",
            generation_uid,
            attempt_uid,
            worker_uid,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not retryable with failed attempt {attempt_uid}")


async def finish_image_generation_terminal_failed(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    attempt_uid: str,
    worker_uid: str,
    error: ImageProviderError,
    latency_ms: int,
) -> bool:
    """Atomically fail one owned attempt and its logical run without retry isolation."""
    if latency_ms < 0:
        raise ValueError("latency_ms must not be negative")
    usage = json.dumps(error.usage.model_dump(mode="json", exclude_none=True) if error.usage else {})
    async with conn.transaction():
        owned_run = await conn.fetchval(
            "SELECT uid FROM image_generation_run WHERE uid = $1 AND worker_uid = $2 AND status = 'started' FOR UPDATE",
            generation_uid,
            worker_uid,
        )
        if owned_run is None:
            return False
        attempt = await conn.fetchval(
            "UPDATE image_generation_attempt SET "
            "status = 'failed', provider_request_id = $3, usage = $4::jsonb, "
            "cost_usd = $5, latency_ms = $6, error_code = $7, error_message = $8, "
            "completed_at = NOW() "
            "WHERE uid = $2 AND generation_uid = $1 AND status = 'started' RETURNING uid",
            generation_uid,
            attempt_uid,
            error.provider_request_id,
            usage,
            error.cost_usd,
            latency_ms,
            error.code,
            error.safe_message,
        )
        if attempt is None:
            return False
        run = await conn.fetchval(
            "UPDATE image_generation_run SET status = 'failed', error_code = $4, "
            "error_message = $5, lease_expires_at = NULL, completed_at = NOW() "
            "WHERE uid = $1 AND worker_uid = $2 AND status = 'started' "
            "AND EXISTS(SELECT 1 FROM image_generation_attempt "
            "WHERE uid = $3 AND generation_uid = $1 AND status = 'failed') RETURNING uid",
            generation_uid,
            worker_uid,
            attempt_uid,
            error.code,
            error.safe_message,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} failure transition was lost")
    return True
