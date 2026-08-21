"""PostgreSQL initialization and upgrade tests for image generation."""

from __future__ import annotations

import json

import asyncpg
import pytest

from pydantic import ValidationError

from topix.image_generation.models import ImageAssetCreate, ImageAssetSource
from topix.store.postgres.schema import _find_schema_file, apply_schema
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
    return _find_schema_file().read_text(encoding="utf-8")


def _schema_without_image_foundation(sql: str) -> str:
    """Construct the exact pre-feature schema by removing the marked block."""
    before, remainder = sql.split(FOUNDATION_BEGIN, maxsplit=1)
    _, after = remainder.split(FOUNDATION_END, maxsplit=1)
    return before + after


async def _table_names(conn: asyncpg.Connection) -> set[str]:
    """Return all tables visible in the disposable current schema."""
    rows = await conn.fetch("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")
    return {row["table_name"] for row in rows}


async def _restore_original_pr01_checks(conn: asyncpg.Connection) -> None:
    """Recreate the original PR-01 checks to exercise startup upgrade behavior."""
    await conn.execute(
        "ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_idempotency_unique;"
        "ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_client_request_uid_check;"
        "ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_request_fingerprint_check;"
        "ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_ownership_check;"
        "ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_pending_storage_key_check;"
        "ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_lifecycle_check;"
        "ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_status_check;"
        "DROP INDEX IF EXISTS idx_image_generation_run_expired_lease;"
        "ALTER TABLE image_generation_run DROP COLUMN IF EXISTS client_request_uid;"
        "ALTER TABLE image_generation_run DROP COLUMN IF EXISTS request_fingerprint;"
        "ALTER TABLE image_generation_run DROP COLUMN IF EXISTS worker_uid;"
        "ALTER TABLE image_generation_run DROP COLUMN IF EXISTS lease_expires_at;"
        "ALTER TABLE image_generation_run DROP COLUMN IF EXISTS pending_output_storage_key;"
        "ALTER TABLE image_asset DROP CONSTRAINT image_asset_storage_key_check;"
        "ALTER TABLE image_asset ADD CONSTRAINT image_asset_storage_key_check CHECK ("
        "storage_key <> '' AND storage_key NOT LIKE '/%' "
        "AND storage_key NOT LIKE '%://%' AND strpos(storage_key, chr(92)) = 0 "
        "AND storage_key !~ '(^|/)\\.{1,2}(/|$)');"
        "ALTER TABLE image_asset DROP CONSTRAINT image_asset_mime_type_check;"
        "ALTER TABLE image_asset ADD CONSTRAINT image_asset_mime_type_check "
        "CHECK (mime_type ~ '^image/[a-z0-9.+-]+$');"
        "ALTER TABLE image_generation_run ADD CONSTRAINT image_generation_run_status_check "
        "CHECK (status IN ('started', 'succeeded', 'failed'));"
        "ALTER TABLE image_generation_run ADD CONSTRAINT image_generation_run_check CHECK ("
        "(status = 'started' AND output_asset_uid IS NULL AND error_code IS NULL "
        "AND error_message IS NULL AND completed_at IS NULL) OR "
        "(status = 'succeeded' AND output_asset_uid IS NOT NULL AND error_code IS NULL "
        "AND error_message IS NULL AND completed_at IS NOT NULL) OR "
        "(status = 'failed' AND output_asset_uid IS NULL AND error_code IS NOT NULL "
        "AND error_message IS NOT NULL AND completed_at IS NOT NULL));"
        "ALTER TABLE image_generation_reference ALTER COLUMN reference_node_uid SET NOT NULL;"
        "DROP INDEX IF EXISTS idx_image_generation_run_retryable;"
    )


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
            "idx_image_generation_run_retryable",
            "idx_image_generation_run_expired_lease",
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
async def test_schema_upgrades_original_pr01_checks_without_data_loss(image_pg_pool: asyncpg.Pool) -> None:
    """Startup safely tightens original PR-01 checks while preserving valid rows."""
    await apply_schema(image_pg_pool)
    user_uid = gen_uid()
    board_uid = gen_uid()
    asset_uid = gen_uid()
    generation_uid = gen_uid()
    async with image_pg_pool.acquire() as conn:
        await _restore_original_pr01_checks(conn)
        await conn.execute(
            "INSERT INTO users (uid, email, username) VALUES ($1, $2, $3)",
            user_uid,
            f"{user_uid}@example.test",
            user_uid,
        )
        await conn.execute("INSERT INTO graphs (uid) VALUES ($1)", board_uid)
        await conn.execute(
            "INSERT INTO image_asset ("
            "uid, board_uid, created_by_user_uid, source_kind, storage_key, "
            "mime_type, byte_size, width, height, content_sha256"
            ") VALUES ($1, $2, $3, 'uploaded', 'images/existing.png', "
            "'image/png', 1, 1, 1, $4)",
            asset_uid,
            board_uid,
            user_uid,
            "a" * 64,
        )
        await conn.execute(
            "INSERT INTO image_generation_run ("
            "uid, user_uid, board_uid, provider, model_id, prompt, status"
            ") VALUES ($1, $2, $3, 'openrouter', 'test/model', 'prompt', 'started')",
            generation_uid,
            user_uid,
            board_uid,
        )

    await apply_schema(image_pg_pool)
    await apply_schema(image_pg_pool)

    async with image_pg_pool.acquire() as conn:
        asset = await conn.fetchrow("SELECT * FROM image_asset WHERE uid = $1", asset_uid)
        assert asset is not None and asset["storage_key"] == "images/existing.png"
        run = await conn.fetchrow("SELECT * FROM image_generation_run WHERE uid = $1", generation_uid)
        assert run is not None
        assert run["client_request_uid"] == f"legacy:{generation_uid}"
        assert run["request_fingerprint"] == "0" * 64
        assert run["worker_uid"] == f"legacy:{generation_uid}"
        assert run["lease_expires_at"] is not None
        reference_node_nullable = await conn.fetchval(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_schema = current_schema() "
            "AND table_name = 'image_generation_reference' "
            "AND column_name = 'reference_node_uid'"
        )
        assert reference_node_nullable == "YES"
        assert (
            await conn.execute(
                "UPDATE image_generation_run SET status = 'retryable' WHERE uid = $1",
                generation_uid,
            )
            == "UPDATE 1"
        )
        await conn.execute(
            "INSERT INTO image_generation_reference ("
            "generation_uid, board_uid, ordinal, reference_node_uid, asset_uid, asset_snapshot"
            ") VALUES ($1, $2, 0, NULL, $3, $4::jsonb)",
            generation_uid,
            board_uid,
            asset_uid,
            json.dumps(
                {
                    "asset_uid": asset_uid,
                    "source_kind": "uploaded",
                    "storage_key": "images/existing.png",
                    "mime_type": "image/png",
                    "byte_size": 1,
                    "width": 1,
                    "height": 1,
                    "content_sha256": "a" * 64,
                }
            ),
        )
        with pytest.raises(asyncpg.CheckViolationError):
            await conn.execute(
                "INSERT INTO image_asset ("
                "uid, board_uid, created_by_user_uid, source_kind, storage_key, "
                "mime_type, byte_size, width, height, content_sha256"
                ") VALUES ($1, $2, $3, 'uploaded', 'images/new.svg', "
                "'image/svg+xml', 1, 1, 1, $4)",
                gen_uid(),
                board_uid,
                user_uid,
                "b" * 64,
            )


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
            ("images/image.svg", "image/svg+xml", "a" * 64),
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
async def test_storage_key_model_and_database_checks_agree(
    initialized_image_pg_pool: asyncpg.Pool,
) -> None:
    """Pydantic and PostgreSQL accept exactly the same representative raw keys."""
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

        cases = (
            ("images/x.png", True),
            ("generated/01ABCDEF/result.avif", True),
            ("./images/x.png", False),
            ("images/./x.png", False),
            ("images/../x.png", False),
            ("images//x.png", False),
            ("images/", False),
            (".", False),
            ("..", False),
            ("/images/x.png", False),
            ("images\\x.png", False),
            ("https://example.test/x.png", False),
        )
        for storage_key, accepted in cases:
            asset_kwargs = {
                "board_uid": board_uid,
                "created_by_user_uid": user_uid,
                "source_kind": ImageAssetSource.UPLOADED,
                "storage_key": storage_key,
                "mime_type": "image/png",
                "byte_size": 1,
                "width": 1,
                "height": 1,
                "content_sha256": "a" * 64,
            }
            if accepted:
                asset = ImageAssetCreate(**asset_kwargs)
                await conn.execute(
                    "INSERT INTO image_asset ("
                    "uid, board_uid, created_by_user_uid, source_kind, storage_key, "
                    "mime_type, byte_size, width, height, content_sha256"
                    ") VALUES ($1, $2, $3, 'uploaded', $4, 'image/png', 1, 1, 1, $5)",
                    asset.uid,
                    board_uid,
                    user_uid,
                    storage_key,
                    "a" * 64,
                )
            else:
                with pytest.raises(ValidationError):
                    ImageAssetCreate(**asset_kwargs)
                with pytest.raises(asyncpg.CheckViolationError):
                    await conn.execute(
                        "INSERT INTO image_asset ("
                        "uid, board_uid, created_by_user_uid, source_kind, storage_key, "
                        "mime_type, byte_size, width, height, content_sha256"
                        ") VALUES ($1, $2, $3, 'uploaded', $4, 'image/png', 1, 1, 1, $5)",
                        gen_uid(),
                        board_uid,
                        user_uid,
                        storage_key,
                        "a" * 64,
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
            "uid, user_uid, board_uid, client_request_uid, request_fingerprint, "
            "provider, model_id, prompt, status"
            ") VALUES ($1, $2, $3, $4, $5, 'openrouter', 'test/model', 'prompt', 'started')",
            generation_uid,
            user_uid,
            board_uid,
            gen_uid(),
            "a" * 64,
        )

        with pytest.raises(asyncpg.ForeignKeyViolationError):
            async with conn.transaction():
                await conn.execute("DELETE FROM graphs WHERE uid = $1", board_uid)
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            async with conn.transaction():
                await conn.execute("DELETE FROM users WHERE uid = $1", user_uid)
