"""Shared-pool store for image assets and generation audit records."""

from __future__ import annotations

import asyncio
import logging

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg

from topix.image_generation.capabilities import get_capability, validate_generation_parameters
from topix.image_generation.models import (
    GenerationAttemptStart,
    GenerationStart,
    GenerationStartOutcome,
    GenerationStorageState,
    ImageAssetCreate,
    ImageAssetRecord,
    ImageGenerationOutputRecord,
    ImageGenerationRecord,
    ImageProviderError,
    PendingOutputCleanup,
    ProviderImageResult,
)
from topix.store.postgres.image_generation import (
    bind_image_generation_output_node,
    clear_generation_pending_output,
    create_image_asset,
    finish_image_generation_attempt_failed,
    finish_image_generation_failed,
    finish_image_generation_succeeded,
    finish_image_generation_terminal_failed,
    get_generation_storage_state,
    get_image_asset,
    get_image_assets,
    get_image_generation,
    get_image_generation_output,
    list_generation_pending_outputs,
    lock_image_generation_output,
    reconcile_image_generations,
    release_image_generation_output_writer,
    renew_image_generation_lease,
    set_generation_pending_output,
    start_image_generation,
    start_image_generation_attempt,
    try_acquire_image_generation_output_writer,
)
from topix.store.postgres.pool import DEFAULT_ACQUIRE_TIMEOUT, create_pool

logger = logging.getLogger(__name__)

OUTPUT_NODE_WRITER_WAIT_SECONDS = 0.25
OUTPUT_NODE_WRITER_RETRY_SECONDS = 0.025
OUTPUT_NODE_WRITER_RELEASE_TIMEOUT_SECONDS = DEFAULT_ACQUIRE_TIMEOUT


class ImageGenerationOutputWriterBusyError(RuntimeError):
    """Signal bounded contention for one generation's canvas writer."""


def _log_output_writer_failure(*, failure_kind: str, generation_uid: str) -> None:
    """Record one bounded writer failure without exposing connection details."""
    messages = {
        "pool_timeout": "Image generation output writer pool acquisition timed out",
        "writer_contended": "Image generation output writer remained contended",
    }
    logger.warning(
        messages[failure_kind],
        extra={
            "failure_kind": failure_kind,
            "generation_uid": generation_uid,
            "wait_milliseconds": round(OUTPUT_NODE_WRITER_WAIT_SECONDS * 1_000),
        },
    )


async def _release_output_writer(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    body_error: BaseException | None,
) -> None:
    """Log unlock anomalies without replacing an error from the writer body."""
    try:
        released = await release_image_generation_output_writer(
            conn,
            generation_uid=generation_uid,
        )
    except BaseException as unlock_error:
        logger.error(
            "Image generation output writer unlock failed",
            extra={
                "generation_uid": generation_uid,
                "unlock_error_type": type(unlock_error).__name__,
            },
        )
        if body_error is None:
            raise
    else:
        if not released:
            logger.error(
                "Image generation output writer lock was not held",
                extra={
                    "generation_uid": generation_uid,
                    "unlock_error_type": "not-held",
                },
            )


async def _release_output_writer_connection(
    pool: asyncpg.Pool,
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    body_error: BaseException | None,
) -> None:
    """Return a writer connection without replacing an in-flight body error."""
    try:
        await pool.release(
            conn,
            timeout=OUTPUT_NODE_WRITER_RELEASE_TIMEOUT_SECONDS,
        )
    except BaseException as release_error:
        logger.error(
            "Image generation output writer connection release failed",
            extra={
                "generation_uid": generation_uid,
                "release_error_type": type(release_error).__name__,
            },
        )
        if body_error is None:
            raise


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

    async def start_generation(self, generation: GenerationStart, *, lease_seconds: float = 120.0) -> GenerationStartOutcome:
        """Validate capabilities and durably win or reuse an idempotent start."""
        validate_generation_parameters(
            generation.model_id,
            generation.parameters,
            reference_count=len(generation.references),
        )
        async with self._pool().acquire() as conn:
            return await start_image_generation(conn, generation, lease_seconds=lease_seconds)

    async def get_assets(self, *, board_uid: str, asset_uids: tuple[str, ...]) -> tuple[ImageAssetRecord, ...]:
        """Resolve board-scoped assets in caller-provided order."""
        async with self._pool().acquire() as conn:
            return await get_image_assets(conn, board_uid=board_uid, asset_uids=asset_uids)

    async def get_asset(self, *, board_uid: str, asset_uid: str) -> ImageAssetRecord | None:
        """Return one board-scoped asset for authenticated content delivery."""
        async with self._pool().acquire() as conn:
            return await get_image_asset(conn, board_uid=board_uid, asset_uid=asset_uid)

    async def get_generation(self, *, board_uid: str, generation_uid: str) -> ImageGenerationRecord | None:
        """Return one board-scoped generation for polling."""
        async with self._pool().acquire() as conn:
            return await get_image_generation(conn, board_uid=board_uid, generation_uid=generation_uid)

    async def get_output_record(
        self,
        *,
        board_uid: str,
        generation_uid: str,
    ) -> ImageGenerationOutputRecord | None:
        """Read one output-node association before cross-store reconciliation."""
        async with self._pool().acquire() as conn:
            return await get_image_generation_output(
                conn,
                board_uid=board_uid,
                generation_uid=generation_uid,
            )

    @asynccontextmanager
    async def output_node_transaction(
        self,
        *,
        board_uid: str,
        generation_uid: str,
        conn: asyncpg.Connection | None = None,
    ) -> AsyncIterator[tuple[asyncpg.Connection, ImageGenerationOutputRecord | None]]:
        """Run the short final output transaction, optionally on an owned connection."""
        if conn is not None:
            async with conn.transaction():
                record = await lock_image_generation_output(
                    conn,
                    board_uid=board_uid,
                    generation_uid=generation_uid,
                )
                yield conn, record
            return
        async with self._pool().acquire() as acquired_conn, acquired_conn.transaction():
            record = await lock_image_generation_output(
                acquired_conn,
                board_uid=board_uid,
                generation_uid=generation_uid,
            )
            yield acquired_conn, record

    @asynccontextmanager
    async def output_node_writer(
        self,
        *,
        board_uid: str,
        generation_uid: str,
    ) -> AsyncIterator[tuple[asyncpg.Connection, ImageGenerationOutputRecord | None]]:
        """Own one generation from Qdrant preparation through final commit."""
        pool = self._pool()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + OUTPUT_NODE_WRITER_WAIT_SECONDS
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                _log_output_writer_failure(
                    failure_kind="writer_contended",
                    generation_uid=generation_uid,
                )
                raise ImageGenerationOutputWriterBusyError("Image generation output writer is busy")
            try:
                conn = await pool.acquire(timeout=remaining)
            except TimeoutError as exc:
                _log_output_writer_failure(
                    failure_kind="pool_timeout",
                    generation_uid=generation_uid,
                )
                raise ImageGenerationOutputWriterBusyError("Image generation output writer is busy") from exc
            operation_error: BaseException | None = None
            acquired = False
            try:
                acquired = await try_acquire_image_generation_output_writer(
                    conn,
                    generation_uid=generation_uid,
                )
                if acquired:
                    body_error: BaseException | None = None
                    try:
                        record = await get_image_generation_output(
                            conn,
                            board_uid=board_uid,
                            generation_uid=generation_uid,
                        )
                        yield conn, record
                    except BaseException as exc:
                        body_error = exc
                        raise
                    finally:
                        await _release_output_writer(
                            conn,
                            generation_uid=generation_uid,
                            body_error=body_error,
                        )
                    return
            except BaseException as exc:
                operation_error = exc
                raise
            finally:
                await _release_output_writer_connection(
                    pool,
                    conn,
                    generation_uid=generation_uid,
                    body_error=operation_error,
                )
            remaining = deadline - loop.time()
            if remaining <= 0:
                _log_output_writer_failure(
                    failure_kind="writer_contended",
                    generation_uid=generation_uid,
                )
                raise ImageGenerationOutputWriterBusyError("Image generation output writer is busy")
            await asyncio.sleep(min(OUTPUT_NODE_WRITER_RETRY_SECONDS, remaining))

    async def bind_output_node(
        self,
        conn: asyncpg.Connection,
        *,
        board_uid: str,
        generation_uid: str,
        output_node_uid: str,
    ) -> bool:
        """Bind one canonical result node inside an output transaction."""
        return await bind_image_generation_output_node(
            conn,
            board_uid=board_uid,
            generation_uid=generation_uid,
            output_node_uid=output_node_uid,
        )

    async def reconcile_incomplete(self) -> int:
        """Fail only expired owned generations under the database writer lock."""
        async with self._pool().acquire() as conn:
            return await reconcile_image_generations(conn)

    async def renew_lease(self, *, generation_uid: str, worker_uid: str, lease_seconds: float) -> bool:
        """Extend one started generation while this worker remains its owner."""
        async with self._pool().acquire() as conn:
            return await renew_image_generation_lease(
                conn,
                generation_uid=generation_uid,
                worker_uid=worker_uid,
                lease_seconds=lease_seconds,
            )

    async def get_storage_state(self, *, generation_uid: str, storage_key: str) -> GenerationStorageState | None:
        """Read authoritative storage references before compensating a write."""
        async with self._pool().acquire() as conn:
            return await get_generation_storage_state(
                conn,
                generation_uid=generation_uid,
                storage_key=storage_key,
            )

    async def set_pending_output(self, *, generation_uid: str, worker_uid: str, storage_key: str) -> bool:
        """Record the deterministic output key before filesystem persistence."""
        async with self._pool().acquire() as conn:
            return await set_generation_pending_output(
                conn,
                generation_uid=generation_uid,
                worker_uid=worker_uid,
                storage_key=storage_key,
            )

    async def clear_pending_output(self, *, generation_uid: str, storage_key: str) -> bool:
        """Acknowledge one exact generated-file cleanup operation."""
        async with self._pool().acquire() as conn:
            return await clear_generation_pending_output(
                conn,
                generation_uid=generation_uid,
                storage_key=storage_key,
            )

    async def list_pending_outputs(self) -> tuple[PendingOutputCleanup, ...]:
        """List durable failed-run file cleanup work."""
        async with self._pool().acquire() as conn:
            return await list_generation_pending_outputs(conn)

    async def start_attempt(self, attempt: GenerationAttemptStart, *, lease_seconds: float = 120.0) -> None:
        """Open the next audit attempt only while its run is retryable."""
        get_capability(attempt.model_id)
        async with self._pool().acquire() as conn:
            await start_image_generation_attempt(conn, attempt, lease_seconds=lease_seconds)

    async def finish_succeeded(
        self,
        *,
        generation_uid: str,
        attempt_uid: str,
        worker_uid: str,
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
                worker_uid=worker_uid,
                output_asset=output_asset,
                result=result,
                latency_ms=latency_ms,
            )

    async def finish_attempt_failed(
        self,
        *,
        generation_uid: str,
        attempt_uid: str,
        worker_uid: str,
        error: ImageProviderError,
        latency_ms: int,
    ) -> None:
        """Finalize one failed attempt while preserving a retryable run."""
        async with self._pool().acquire() as conn:
            await finish_image_generation_attempt_failed(
                conn,
                generation_uid=generation_uid,
                attempt_uid=attempt_uid,
                worker_uid=worker_uid,
                error=error,
                latency_ms=latency_ms,
            )

    async def finish_failed(self, *, generation_uid: str, attempt_uid: str, worker_uid: str) -> None:
        """Make a retryable generation terminal using a preserved failure."""
        async with self._pool().acquire() as conn:
            await finish_image_generation_failed(
                conn,
                generation_uid=generation_uid,
                attempt_uid=attempt_uid,
                worker_uid=worker_uid,
            )

    async def finish_terminal_failed(
        self,
        *,
        generation_uid: str,
        attempt_uid: str,
        worker_uid: str,
        error: ImageProviderError,
        latency_ms: int,
    ) -> bool:
        """Atomically finalize an owned no-retry attempt and run as failed."""
        async with self._pool().acquire() as conn:
            return await finish_image_generation_terminal_failed(
                conn,
                generation_uid=generation_uid,
                attempt_uid=attempt_uid,
                worker_uid=worker_uid,
                error=error,
                latency_ms=latency_ms,
            )

    async def close(self) -> None:
        """Close only a private pool created by this store."""
        if self._pg_pool is not None and self._owns_pool:
            await self._pg_pool.close()
        self._pg_pool = None
        self._owns_pool = False
