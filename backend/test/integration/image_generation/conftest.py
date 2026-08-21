"""Isolated PostgreSQL fixtures for image-generation integration tests."""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import uuid4

import asyncpg
import pytest_asyncio

from topix.config.config import PostgresConfig
from topix.store.postgres.schema import apply_schema


@pytest_asyncio.fixture(scope="function", loop_scope="function")
async def image_pg_pool() -> AsyncIterator[asyncpg.Pool]:
    """Yield a pool whose connections use a disposable PostgreSQL schema."""
    dsn = PostgresConfig().dsn()
    schema_name = f"test_image_generation_{uuid4().hex}"
    admin = await asyncpg.connect(dsn)
    await admin.execute(f'CREATE SCHEMA "{schema_name}"')

    async def initialize_connection(conn: asyncpg.Connection) -> None:
        """Confine one pooled connection to the disposable schema."""
        await conn.execute(f'SET search_path TO "{schema_name}"')

    pool = await asyncpg.create_pool(
        dsn,
        min_size=1,
        max_size=3,
        setup=initialize_connection,
    )
    try:
        yield pool
    finally:
        await pool.close()
        await admin.execute(f'DROP SCHEMA "{schema_name}" CASCADE')
        await admin.close()


@pytest_asyncio.fixture(scope="function", loop_scope="function")
async def initialized_image_pg_pool(image_pg_pool: asyncpg.Pool) -> asyncpg.Pool:
    """Yield a disposable pool after applying the production schema."""
    await apply_schema(image_pg_pool)
    return image_pg_pool
