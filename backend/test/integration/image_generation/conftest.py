"""Isolated PostgreSQL fixtures for image-generation integration tests."""

from __future__ import annotations

import os

from collections.abc import AsyncIterator
from uuid import uuid4

import asyncpg
import pytest_asyncio

from topix.config.config import Config
from topix.datatypes.stage import StageEnum
from topix.store.postgres.schema import apply_schema

TEST_DATABASE_OPT_IN = "DIM0_IMAGE_GENERATION_DB_TEST"


def _require_disposable_test_database(config: Config) -> None:
    """Fail closed unless the loaded test config has an explicit DB-test opt-in."""
    if config.stage is not StageEnum.TEST or os.getenv(TEST_DATABASE_OPT_IN) != "1":
        raise RuntimeError(f"Image-generation DB tests require stage=test and {TEST_DATABASE_OPT_IN}=1")


@pytest_asyncio.fixture(scope="function", loop_scope="function")
async def image_pg_pool(config: Config) -> AsyncIterator[asyncpg.Pool]:
    """Yield a pool whose connections use a disposable PostgreSQL schema."""
    _require_disposable_test_database(config)
    dsn = config.run.databases.postgres.dsn()
    schema_name = f"test_image_generation_{uuid4().hex}"
    admin: asyncpg.Connection | None = None
    pool: asyncpg.Pool | None = None
    schema_created = False

    async def initialize_connection(conn: asyncpg.Connection) -> None:
        """Confine one pooled connection to the disposable schema."""
        await conn.execute(f'SET search_path TO "{schema_name}"')

    try:
        admin = await asyncpg.connect(dsn)
        await admin.execute(f'CREATE SCHEMA "{schema_name}"')
        schema_created = True
        pool = await asyncpg.create_pool(
            dsn,
            min_size=1,
            max_size=1,
            setup=initialize_connection,
        )
        yield pool
    finally:
        try:
            if pool is not None:
                await pool.close()
        finally:
            if admin is not None:
                try:
                    if schema_created:
                        await admin.execute(f'DROP SCHEMA "{schema_name}" CASCADE')
                finally:
                    await admin.close()


@pytest_asyncio.fixture(scope="function", loop_scope="function")
async def initialized_image_pg_pool(image_pg_pool: asyncpg.Pool) -> asyncpg.Pool:
    """Yield a disposable pool after applying the production schema."""
    await apply_schema(image_pg_pool)
    return image_pg_pool
