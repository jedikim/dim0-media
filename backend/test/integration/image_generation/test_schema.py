"""PostgreSQL initialization and upgrade tests for image generation."""

from __future__ import annotations

from pathlib import Path

import asyncpg
import pytest

from topix.store.postgres.schema import apply_schema
from topix.utils.common import gen_uid

FOUNDATION_BEGIN = "-- BEGIN AI IMAGE GENERATION FOUNDATION"
FOUNDATION_END = "-- END AI IMAGE GENERATION FOUNDATION"
EXPECTED_TABLES = {
    "image_asset",
    "image_generation_run",
    "image_generation_attempt",
    "image_generation_reference",
}


def _schema_sql() -> str:
    """Read the canonical schema from the repository root."""
    return (Path(__file__).parents[4] / "build" / "schema.sql").read_text(encoding="utf-8")


def _schema_without_image_foundation(sql: str) -> str:
    """Construct the exact pre-feature schema by removing the marked block."""
    before, remainder = sql.split(FOUNDATION_BEGIN, maxsplit=1)
    _, after = remainder.split(FOUNDATION_END, maxsplit=1)
    return before + after


async def _table_names(conn: asyncpg.Connection) -> set[str]:
    """Return all tables visible in the disposable current schema."""
    rows = await conn.fetch("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")
    return {row["table_name"] for row in rows}


@pytest.mark.asyncio
async def test_schema_initialization_is_idempotent(image_pg_pool: asyncpg.Pool) -> None:
    """The production startup schema applies twice to an empty database."""
    await apply_schema(image_pg_pool)
    await apply_schema(image_pg_pool)

    async with image_pg_pool.acquire() as conn:
        assert EXPECTED_TABLES <= await _table_names(conn)

        index_rows = await conn.fetch("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()")
        indexes = {row["indexname"] for row in index_rows}
        assert {
            "idx_image_asset_board_created_at",
            "idx_image_asset_board_sha256",
            "idx_image_generation_run_board_started_at",
            "idx_image_generation_run_user_started_at",
            "idx_image_generation_run_started_pending",
            "idx_image_generation_attempt_provider_request_id",
            "idx_image_generation_reference_asset_uid",
        } <= indexes


@pytest.mark.asyncio
async def test_schema_upgrades_pre_feature_database_without_data_loss(image_pg_pool: asyncpg.Pool) -> None:
    """Applying the full schema preserves rows created by the exact prior schema."""
    user_uid = gen_uid()
    graph_uid = gen_uid()
    async with image_pg_pool.acquire() as conn:
        await conn.execute(_schema_without_image_foundation(_schema_sql()))
        await conn.execute(
            "INSERT INTO users (uid, email, username, name) VALUES ($1, $2, $3, 'Upgrade Sentinel')",
            user_uid,
            f"{user_uid}@example.test",
            user_uid,
        )
        await conn.execute(
            "INSERT INTO graphs (uid, label) VALUES ($1, 'Upgrade Sentinel')",
            graph_uid,
        )

    await apply_schema(image_pg_pool)

    async with image_pg_pool.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM users WHERE uid = $1", user_uid) == 1
        assert await conn.fetchval("SELECT count(*) FROM graphs WHERE uid = $1", graph_uid) == 1
        assert EXPECTED_TABLES <= await _table_names(conn)


@pytest.mark.asyncio
async def test_schema_rejects_untrusted_asset_metadata(initialized_image_pg_pool: asyncpg.Pool) -> None:
    """Database constraints reject external locations and malformed image metadata."""
    user_uid = gen_uid()
    board_uid = gen_uid()
    async with initialized_image_pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (uid, email, username) VALUES ($1, $2, $3)",
            user_uid,
            f"{user_uid}@example.test",
            user_uid,
        )
        await conn.execute("INSERT INTO graphs (uid) VALUES ($1)", board_uid)

        for storage_key, mime_type, content_sha256 in (
            ("https://example.test/image.png", "image/png", "a" * 64),
            ("../image.png", "image/png", "a" * 64),
            ("images/image.png", "text/plain", "a" * 64),
            ("images/image.png", "image/png", "NOT-A-SHA"),
        ):
            with pytest.raises(asyncpg.CheckViolationError):
                async with conn.transaction():
                    await conn.execute(
                        "INSERT INTO image_asset ("
                        "uid, board_uid, created_by_user_uid, source_kind, storage_key, "
                        "mime_type, byte_size, width, height, content_sha256"
                        ") VALUES ($1, $2, $3, 'uploaded', $4, $5, 1, 1, 1, $6)",
                        gen_uid(),
                        board_uid,
                        user_uid,
                        storage_key,
                        mime_type,
                        content_sha256,
                    )


@pytest.mark.asyncio
async def test_schema_has_no_provider_secret_columns(initialized_image_pg_pool: asyncpg.Pool) -> None:
    """Image-generation tables expose no place for credentials or headers."""
    async with initialized_image_pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1::text[])",
            sorted(EXPECTED_TABLES),
        )
    columns = {row["column_name"].lower() for row in rows}
    forbidden = {"api_key", "authorization", "auth_header", "headers"}
    assert columns.isdisjoint(forbidden)


@pytest.mark.asyncio
async def test_audit_foreign_keys_restrict_hard_delete(initialized_image_pg_pool: asyncpg.Pool) -> None:
    """A generation audit record prevents hard deletion of its user and board."""
    user_uid = gen_uid()
    board_uid = gen_uid()
    generation_uid = gen_uid()
    async with initialized_image_pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (uid, email, username) VALUES ($1, $2, $3)",
            user_uid,
            f"{user_uid}@example.test",
            user_uid,
        )
        await conn.execute("INSERT INTO graphs (uid) VALUES ($1)", board_uid)
        await conn.execute(
            "INSERT INTO image_generation_run ("
            "uid, user_uid, board_uid, provider, model_id, prompt, status"
            ") VALUES ($1, $2, $3, 'openrouter', 'test/model', 'prompt', 'started')",
            generation_uid,
            user_uid,
            board_uid,
        )

        with pytest.raises(asyncpg.ForeignKeyViolationError):
            async with conn.transaction():
                await conn.execute("DELETE FROM graphs WHERE uid = $1", board_uid)
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            async with conn.transaction():
                await conn.execute("DELETE FROM users WHERE uid = $1", user_uid)
