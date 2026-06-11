"""Store wrapper for per-user, per-note mini-app widget state.

Thin facade over :mod:`topix.store.postgres.mini_app_state`: holds the
shared asyncpg pool and offers a small CRUD-style API that the API
router uses. Mirrors the shape of :class:`topix.store.chat.ChatStore`
and :class:`topix.store.user.UserStore` for consistency.
"""

from __future__ import annotations

from typing import Any

import asyncpg

from topix.store.postgres.mini_app_state import (
    delete_state,
    get_state,
    upsert_state,
)
from topix.store.postgres.pool import create_pool


class MiniAppStateStore:
    """Store for mini-app widget state."""

    def __init__(self) -> None:
        """Initialize the store with no pool yet (call ``open`` first)."""
        self._pg_pool: asyncpg.Pool | None = None
        self._owns_pool = False


    async def open(self, pool: asyncpg.Pool | None = None) -> None:
        """Open the store. Pass a shared pool or omit to create a private one."""
        if pool is None:
            self._pg_pool = await create_pool()
            self._owns_pool = True
        else:
            self._pg_pool = pool
            self._owns_pool = False


    async def close(self) -> None:
        """Close the private pool, if any. No-op when sharing a pool."""
        if self._owns_pool and self._pg_pool is not None:
            await self._pg_pool.close()
            self._pg_pool = None


    async def get_state(self, note_uid: str, user_uid: str) -> Any | None:
        """Return the saved state for ``(note, user)`` or ``None`` if absent."""
        assert self._pg_pool is not None, "store not opened"
        async with self._pg_pool.acquire() as conn:
            return await get_state(conn, note_uid, user_uid)


    async def save_state(
        self,
        note_uid: str,
        user_uid: str,
        state: Any,
    ) -> None:
        """Insert or overwrite the saved state for ``(note, user)``."""
        assert self._pg_pool is not None, "store not opened"
        async with self._pg_pool.acquire() as conn:
            await upsert_state(conn, note_uid, user_uid, state)


    async def delete_state(self, note_uid: str, user_uid: str) -> None:
        """Remove the saved state row for ``(note, user)``. No-op when absent."""
        assert self._pg_pool is not None, "store not opened"
        async with self._pg_pool.acquire() as conn:
            await delete_state(conn, note_uid, user_uid)
