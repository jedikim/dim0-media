"""PostgreSQL persistence for auditable image generation."""

from __future__ import annotations

import json

from datetime import datetime

import asyncpg

from topix.image_generation.models import (
    GenerationAttemptStart,
    GenerationIdempotencyConflictError,
    GenerationStart,
    GenerationStartOutcome,
    ImageAssetCreate,
    ImageAssetRecord,
    ImageAssetResolutionError,
    ImageAssetSource,
    ImageGenerationRecord,
    ImageProviderError,
    InvalidGenerationTransition,
    ProviderImageResult,
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
        "SELECT uid, board_uid, model_id, status, output_asset_uid, error_code, "
        "error_message, started_at, completed_at "
        "FROM image_generation_run WHERE uid = $1 AND board_uid = $2",
        generation_uid,
        board_uid,
    )
    return ImageGenerationRecord.model_validate(dict(row)) if row is not None else None


async def reconcile_image_generations(
    conn: asyncpg.Connection,
    *,
    cutoff: datetime,
) -> int:
    """Terminally fail incomplete generations left by an earlier process."""
    safe_message = "The image generation worker stopped before completion"
    async with conn.transaction():
        await conn.execute(
            "UPDATE image_generation_attempt AS attempt SET "
            "status = 'failed', error_code = 'worker_lost', error_message = $2, "
            "latency_ms = GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - attempt.started_at)) * 1000)::bigint), "
            "completed_at = NOW() "
            "FROM image_generation_run AS run "
            "WHERE attempt.generation_uid = run.uid AND attempt.status = 'started' "
            "AND run.status = 'started' AND run.started_at < $1",
            cutoff,
            safe_message,
        )
        rows = await conn.fetch(
            "UPDATE image_generation_run SET status = 'failed', "
            "error_code = 'worker_lost', error_message = $2, completed_at = NOW() "
            "WHERE status IN ('started', 'retryable') AND started_at < $1 "
            "RETURNING uid",
            cutoff,
            safe_message,
        )
    return len(rows)


async def start_image_generation(conn: asyncpg.Connection, generation: GenerationStart) -> GenerationStartOutcome:
    """Atomically win or reuse a durable idempotent generation request."""
    parameters = json.dumps(generation.parameters.model_dump(mode="json", exclude_none=True))
    if generation.request_fingerprint is None:
        raise ValueError("GenerationStart must carry its canonical fingerprint")

    async with conn.transaction():
        inserted = await conn.fetchrow(
            "INSERT INTO image_generation_run ("
            "uid, user_uid, board_uid, client_request_uid, request_fingerprint, "
            "generator_node_uid, provider, model_id, prompt, parameters, status"
            ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'started') "
            "ON CONFLICT (user_uid, board_uid, client_request_uid) DO NOTHING "
            "RETURNING uid, status",
            generation.uid,
            generation.user_uid,
            generation.board_uid,
            generation.client_request_uid,
            generation.request_fingerprint,
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


async def start_image_generation_attempt(conn: asyncpg.Connection, attempt: GenerationAttemptStart) -> None:
    """Atomically reopen a retryable run and insert its next started attempt."""
    async with conn.transaction():
        run = await conn.fetchval(
            "UPDATE image_generation_run SET status = 'started' "
            "WHERE uid = $1 AND status = 'retryable' "
            "AND $2 = (SELECT MAX(existing.attempt_number) + 1 "
            "FROM image_generation_attempt AS existing WHERE existing.generation_uid = $1) "
            "RETURNING uid",
            attempt.generation_uid,
            attempt.attempt_number,
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
            "status = 'succeeded', output_asset_uid = $2, completed_at = NOW() "
            "WHERE uid = $1 AND board_uid = $3 AND status = 'started' "
            "RETURNING uid",
            generation_uid,
            output_asset.uid,
            output_asset.board_uid,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not started on the output asset board")


async def finish_image_generation_attempt_failed(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    attempt_uid: str,
    error: ImageProviderError,
    latency_ms: int,
) -> None:
    """Preserve a failed attempt and leave its logical run retryable."""
    if latency_ms < 0:
        raise ValueError("latency_ms must not be negative")
    usage = json.dumps(error.usage.model_dump(mode="json", exclude_none=True) if error.usage else {})

    async with conn.transaction():
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
            "UPDATE image_generation_run SET status = 'retryable' WHERE uid = $1 AND status = 'started' RETURNING uid",
            generation_uid,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not started")


async def finish_image_generation_failed(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    attempt_uid: str,
) -> None:
    """Finalize a retryable run using one preserved failed attempt."""
    async with conn.transaction():
        run = await conn.fetchval(
            "UPDATE image_generation_run AS run SET "
            "status = 'failed', error_code = attempt.error_code, "
            "error_message = attempt.error_message, completed_at = NOW() "
            "FROM image_generation_attempt AS attempt "
            "WHERE run.uid = $1 AND run.status = 'retryable' "
            "AND attempt.uid = $2 AND attempt.generation_uid = run.uid "
            "AND attempt.status = 'failed' "
            "AND attempt.attempt_number = ("
            "SELECT MAX(latest.attempt_number) FROM image_generation_attempt AS latest "
            "WHERE latest.generation_uid = run.uid"
            ") "
            "RETURNING run.uid",
            generation_uid,
            attempt_uid,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not retryable with failed attempt {attempt_uid}")
