"""Shared-pool store for authenticated global image history reads."""

from __future__ import annotations

import asyncpg

from topix.image_generation.history import (
    ImageHistoryAssetScope,
    ImageHistoryCursor,
    ImageHistoryPage,
    ImageHistorySummary,
)
from topix.image_generation.models import GenerationStatus
from topix.store.postgres.image_history import (
    get_image_history_asset_scope,
    get_image_history_summary,
    list_image_history,
)
from topix.store.postgres.pool import create_pool


class ImageHistoryStore:
    """Expose read-only image history projections through one PostgreSQL pool."""

    def __init__(self) -> None:
        """Create a closed store without allocating connections."""
        self._pg_pool: asyncpg.Pool | None = None
        self._owns_pool = False

    async def open(self, pool: asyncpg.Pool | None = None) -> None:
        """Open with the shared pool or create a private standalone pool."""
        if pool is None:
            self._pg_pool = await create_pool()
            self._owns_pool = True
        else:
            self._pg_pool = pool
            self._owns_pool = False

    def _pool(self) -> asyncpg.Pool:
        """Return the open pool or fail before persistence access."""
        if self._pg_pool is None:
            raise RuntimeError("ImageHistoryStore is not open")
        return self._pg_pool

    async def summary(self) -> ImageHistorySummary:
        """Return global and per-user provider usage summaries."""
        async with self._pool().acquire() as conn:
            return await get_image_history_summary(conn)

    async def list(
        self,
        *,
        limit: int,
        cursor: ImageHistoryCursor | None,
        user_uid: str | None,
        status: GenerationStatus | None,
    ) -> ImageHistoryPage:
        """Return one filtered newest-first keyset page."""
        async with self._pool().acquire() as conn:
            return await list_image_history(
                conn,
                limit=limit,
                cursor=cursor,
                user_uid=user_uid,
                status=status,
            )

    async def get_asset_scope(self, *, generation_uid: str, asset_uid: str) -> ImageHistoryAssetScope | None:
        """Return a board scope only for an asset related to the generation."""
        async with self._pool().acquire() as conn:
            return await get_image_history_asset_scope(
                conn,
                generation_uid=generation_uid,
                asset_uid=asset_uid,
            )

    async def close(self) -> None:
        """Close only a private pool created by this store."""
        if self._pg_pool is not None and self._owns_pool:
            await self._pg_pool.close()
        self._pg_pool = None
        self._owns_pool = False
