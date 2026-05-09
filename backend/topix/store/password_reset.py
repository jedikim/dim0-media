"""Password reset store module."""

import asyncpg

from topix.datatypes.password_reset import PasswordResetToken
from topix.store.postgres.password_reset import (
    _dangerous_hard_delete_password_reset_tokens_by_user_uid,
    get_active_password_reset_token_by_hash,
    get_latest_password_reset_token_by_user_uid,
    mark_password_reset_token_used_by_uid,
    upsert_password_reset_token,
)
from topix.store.postgres.pool import create_pool


class PasswordResetStore:
    """Store for managing password reset tokens."""

    def __init__(self):
        """Initialize the password reset store."""
        self._pg_pool: asyncpg.Pool | None = None
        self._owns_pool = False

    async def open(self, pool: asyncpg.Pool | None = None):
        """Open the store. Pass a shared pool, or omit to create a private one."""
        if pool is None:
            self._pg_pool = await create_pool()
            self._owns_pool = True
        else:
            self._pg_pool = pool
            self._owns_pool = False

    async def save_token(self, token: PasswordResetToken) -> PasswordResetToken:
        """Create/replace active reset token for a user."""
        async with self._pg_pool.acquire() as conn:
            return await upsert_password_reset_token(conn, token)

    async def get_active_token_by_hash(self, token_hash: str) -> PasswordResetToken | None:
        """Fetch an active reset token by hash."""
        async with self._pg_pool.acquire() as conn:
            return await get_active_password_reset_token_by_hash(conn, token_hash)

    async def mark_token_used(self, token_uid: str) -> None:
        """Mark a reset token as used."""
        async with self._pg_pool.acquire() as conn:
            await mark_password_reset_token_used_by_uid(conn, token_uid)

    async def get_latest_token_for_user(self, user_uid: str) -> PasswordResetToken | None:
        """Fetch latest reset token for a user."""
        async with self._pg_pool.acquire() as conn:
            return await get_latest_password_reset_token_by_user_uid(conn, user_uid)

    async def _dangerous_hard_delete_tokens_for_user(self, user_uid: str) -> None:
        """Hard delete all reset tokens for a user (tests only)."""
        async with self._pg_pool.acquire() as conn:
            await _dangerous_hard_delete_password_reset_tokens_by_user_uid(conn, user_uid)

    async def close(self):
        """Close the store. Only closes the pool if this store created it."""
        if self._pg_pool and self._owns_pool:
            await self._pg_pool.close()
