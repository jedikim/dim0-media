"""Integration tests for password reset postgres store."""

from datetime import timedelta

import asyncpg
import pytest

from topix.api.utils.email_verification import utc_now
from topix.api.utils.password_reset import hash_password_reset_token
from topix.datatypes.password_reset import PasswordResetToken
from topix.store.postgres.password_reset import (
    _dangerous_hard_delete_password_reset_tokens_by_user_uid,
    get_active_password_reset_token_by_hash,
    get_latest_password_reset_token_by_user_uid,
    mark_password_reset_token_used_by_uid,
    upsert_password_reset_token,
)
from topix.utils.common import gen_uid


@pytest.mark.asyncio
async def test_password_reset_token_lifecycle(conn: asyncpg.Connection):
    """Should create, resolve, consume, and replace password reset tokens correctly."""
    user_uid = gen_uid()
    user_email = f"{user_uid}@test.com"

    await conn.execute(
        "INSERT INTO users (uid, email, username, name, password_hash) VALUES ($1, $2, $3, $4, $5)",
        user_uid,
        user_email,
        user_uid,
        "Test User",
        "hashed_password",
    )

    now = utc_now()
    token_1_raw = "reset-token-one"
    token_1 = PasswordResetToken(
        user_uid=user_uid,
        token_hash=hash_password_reset_token(token_1_raw),
        expires_at=now + timedelta(hours=1),
        created_at=now,
    )
    saved_token_1 = await upsert_password_reset_token(conn, token_1)
    assert saved_token_1.id is not None

    active = await get_active_password_reset_token_by_hash(conn, token_1.token_hash)
    assert active is not None
    assert active.user_uid == user_uid

    await mark_password_reset_token_used_by_uid(conn, saved_token_1.uid)
    consumed = await get_active_password_reset_token_by_hash(conn, token_1.token_hash)
    assert consumed is None

    token_2 = PasswordResetToken(
        user_uid=user_uid,
        token_hash=hash_password_reset_token("reset-token-two"),
        expires_at=now + timedelta(hours=1),
    )
    await upsert_password_reset_token(conn, token_2)
    latest = await get_latest_password_reset_token_by_user_uid(conn, user_uid)
    assert latest is not None
    assert latest.token_hash == token_2.token_hash

    await _dangerous_hard_delete_password_reset_tokens_by_user_uid(conn, user_uid)
    await conn.execute("DELETE FROM users WHERE uid = $1", user_uid)
