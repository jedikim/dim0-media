"""Idempotent schema bootstrap.

Runs `build/schema.sql` against Postgres on every backend startup so existing
self-hosted DBs pick up additive changes without manual migration steps.
"""

import logging

from pathlib import Path

import asyncpg

logger = logging.getLogger(__name__)


SCHEMA_FILENAME = "schema.sql"


def _find_schema_file() -> Path:
    """Locate build/schema.sql by walking up from this module."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "build" / SCHEMA_FILENAME
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "Could not locate build/schema.sql relative to "
        f"{here}. Make sure schema.sql is bundled with the backend image."
    )


async def apply_schema(pool: asyncpg.Pool) -> None:
    """Apply the idempotent schema.sql against the given pool.

    Safe to call on every startup: every statement uses IF NOT EXISTS or
    ON CONFLICT DO NOTHING. Adds <100ms when nothing has changed.
    """
    schema_path = _find_schema_file()
    sql = schema_path.read_text(encoding="utf-8")
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(sql)
    logger.info("Applied schema.sql from %s", schema_path)
