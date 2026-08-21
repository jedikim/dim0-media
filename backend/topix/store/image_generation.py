"""Shared-pool store for image assets and generation audit records."""

from __future__ import annotations

import asyncpg

from topix.image_generation.capabilities import get_capability, validate_generation_parameters
from topix.image_generation.models import (
    GenerationAttemptStart,
    GenerationStart,
    ImageAssetCreate,
    ImageProviderError,
    ProviderImageResult,
)
from topix.store.postgres.image_generation import (
    create_image_asset,
    finish_image_generation_attempt_failed,
    finish_image_generation_failed,
    finish_image_generation_succeeded,
    start_image_generation,
    start_image_generation_attempt,
)
from topix.store.postgres.pool import create_pool


class ImageGenerationStore:
    """Persist trusted assets and auditable generation lifecycle transitions."""

    def __init__(self) -> None:
        """Initialize a closed image-generation store."""
        self._pg_pool: asyncpg.Pool | None = None
        self._owns_pool = False

    async def open(self, pool: asyncpg.Pool | None = None) -> None:
        """Open with the shared pool, or create a private pool for standalone use."""
        if pool is None:
            self._pg_pool = await create_pool()
            self._owns_pool = True
        else:
            self._pg_pool = pool
            self._owns_pool = False

    def _pool(self) -> asyncpg.Pool:
        """Return the open pool or fail before attempting persistence."""
        if self._pg_pool is None:
            raise RuntimeError("ImageGenerationStore is not open")
        return self._pg_pool

    async def add_asset(self, asset: ImageAssetCreate) -> None:
        """Register trusted immutable metadata for an image asset."""
        async with self._pool().acquire() as conn:
            await create_image_asset(conn, asset)

    async def start_generation(self, generation: GenerationStart) -> None:
        """Validate capabilities and record a started attempt before provider work."""
        validate_generation_parameters(
            generation.model_id,
            generation.parameters,
            reference_count=len(generation.references),
        )
        async with self._pool().acquire() as conn:
            await start_image_generation(conn, generation)

    async def start_attempt(self, attempt: GenerationAttemptStart) -> None:
        """Open the next audit attempt only while its run is retryable."""
        get_capability(attempt.model_id)
        async with self._pool().acquire() as conn:
            await start_image_generation_attempt(conn, attempt)

    async def finish_succeeded(
        self,
        *,
        generation_uid: str,
        attempt_uid: str,
        output_asset: ImageAssetCreate,
        result: ProviderImageResult,
        latency_ms: int,
    ) -> None:
        """Register one generated asset and atomically finalize success."""
        async with self._pool().acquire() as conn:
            await finish_image_generation_succeeded(
                conn,
                generation_uid=generation_uid,
                attempt_uid=attempt_uid,
                output_asset=output_asset,
                result=result,
                latency_ms=latency_ms,
            )

    async def finish_attempt_failed(
        self,
        *,
        generation_uid: str,
        attempt_uid: str,
        error: ImageProviderError,
        latency_ms: int,
    ) -> None:
        """Finalize one failed attempt while preserving a retryable run."""
        async with self._pool().acquire() as conn:
            await finish_image_generation_attempt_failed(
                conn,
                generation_uid=generation_uid,
                attempt_uid=attempt_uid,
                error=error,
                latency_ms=latency_ms,
            )

    async def finish_failed(self, *, generation_uid: str, attempt_uid: str) -> None:
        """Make a retryable generation terminal using a preserved failure."""
        async with self._pool().acquire() as conn:
            await finish_image_generation_failed(
                conn,
                generation_uid=generation_uid,
                attempt_uid=attempt_uid,
            )

    async def close(self) -> None:
        """Close only a private pool created by this store."""
        if self._pg_pool is not None and self._owns_pool:
            await self._pg_pool.close()
