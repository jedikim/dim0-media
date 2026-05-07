"""Async Postgres connection pool for topix."""

import asyncpg

from topix.config.config import Config

DEFAULT_MIN_SIZE = 5
DEFAULT_MAX_SIZE = 25
DEFAULT_ACQUIRE_TIMEOUT = 10.0
DEFAULT_COMMAND_TIMEOUT = 30.0


async def create_pool(
    *,
    min_size: int = DEFAULT_MIN_SIZE,
    max_size: int = DEFAULT_MAX_SIZE,
    timeout: float = DEFAULT_ACQUIRE_TIMEOUT,
    command_timeout: float = DEFAULT_COMMAND_TIMEOUT,
) -> asyncpg.Pool:
    """Create a new Postgres connection pool.

    Defaults are tuned so a single shared pool fits comfortably under typical
    Postgres ``max_connections`` ceilings while keeping a warm baseline of
    connections to avoid paying the connect handshake on bursty traffic.
    """
    config = Config.instance()
    postgres_url = config.run.databases.postgres.dsn()
    return await asyncpg.create_pool(
        postgres_url,
        min_size=min_size,
        max_size=max_size,
        timeout=timeout,
        command_timeout=command_timeout,
    )
