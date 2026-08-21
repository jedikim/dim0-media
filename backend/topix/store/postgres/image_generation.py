"""PostgreSQL persistence for auditable image generation."""

from __future__ import annotations

import json

import asyncpg

from topix.image_generation.models import (
    GenerationStart,
    ImageAssetCreate,
    ImageAssetResolutionError,
    ImageAssetSource,
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


async def start_image_generation(conn: asyncpg.Connection, generation: GenerationStart) -> None:
    """Atomically insert a started run, attempt, and trusted reference snapshots."""
    parameters = json.dumps(generation.parameters.model_dump(mode="json", exclude_none=True))

    async with conn.transaction():
        await conn.execute(
            "INSERT INTO image_generation_run ("
            "uid, user_uid, board_uid, generator_node_uid, provider, model_id, "
            "prompt, parameters, status"
            ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'started')",
            generation.uid,
            generation.user_uid,
            generation.board_uid,
            generation.generator_node_uid,
            generation.provider,
            generation.model_id,
            generation.prompt,
            parameters,
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

        for reference in generation.references:
            inserted_uid = await conn.fetchval(
                "INSERT INTO image_generation_reference ("
                "generation_uid, board_uid, ordinal, reference_node_uid, asset_uid, asset_snapshot"
                ") "
                "SELECT $1, $2, $3, $4, asset.uid, "
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
                "FROM image_asset AS asset "
                "WHERE asset.uid = $5 AND asset.board_uid = $2 "
                "RETURNING asset_uid",
                generation.uid,
                generation.board_uid,
                reference.ordinal,
                reference.reference_node_uid,
                reference.asset_uid,
            )
            if inserted_uid is None:
                raise ImageAssetResolutionError(f"Image asset {reference.asset_uid} is unavailable on board {generation.board_uid}")


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


async def finish_image_generation_failed(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    attempt_uid: str,
    error: ImageProviderError,
    latency_ms: int,
) -> None:
    """Atomically finalize a started attempt and run with a safe failure."""
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
            "UPDATE image_generation_run SET "
            "status = 'failed', error_code = $2, error_message = $3, completed_at = NOW() "
            "WHERE uid = $1 AND status = 'started' "
            "RETURNING uid",
            generation_uid,
            error.code,
            error.safe_message,
        )
        if run is None:
            raise InvalidGenerationTransition(f"Generation {generation_uid} is not started")
