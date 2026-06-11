"""Mini-app per-user state helpers.

Per-user, per-note JSON blob persisted by the widget's call to
``host.saveState(...)`` and read back into the iframe on next render.
See mini-app-archi.md §12 for the lifecycle.

JSON serialization is done in Python (``json.dumps``/``json.loads``)
rather than via an asyncpg codec, so this module doesn't impose a
JSONB codec on the shared pool and doesn't affect any other consumer.
"""

from __future__ import annotations

import json

from typing import Any

import asyncpg


async def get_state(
    conn: asyncpg.Connection,
    note_uid: str,
    user_uid: str,
) -> Any | None:
    """Fetch the saved state for ``(note_uid, user_uid)``.

    Returns ``None`` if no row exists yet (first render for this
    user-note pair).
    """
    row = await conn.fetchrow(
        "SELECT state FROM mini_app_state "
        "WHERE note_uid = $1 AND user_uid = $2",
        note_uid,
        user_uid,
    )
    if row is None:
        return None
    raw = row["state"]
    # asyncpg returns JSONB columns as the raw stored JSON text by
    # default. Decode here so callers get the native Python value.
    return json.loads(raw) if isinstance(raw, str) else raw


async def upsert_state(
    conn: asyncpg.Connection,
    note_uid: str,
    user_uid: str,
    state: Any,
) -> None:
    """Insert or replace the saved state for ``(note_uid, user_uid)``.

    ``state`` is any JSON-serializable value (typically a dict or a
    scalar). The previous value, if any, is overwritten — widget state
    has no history requirement in v1.
    """
    await conn.execute(
        "INSERT INTO mini_app_state (note_uid, user_uid, state, created_at, updated_at) "
        "VALUES ($1, $2, $3::jsonb, NOW(), NOW()) "
        "ON CONFLICT (note_uid, user_uid) DO UPDATE "
        "SET state = EXCLUDED.state, updated_at = NOW()",
        note_uid,
        user_uid,
        json.dumps(state),
    )


async def delete_state(
    conn: asyncpg.Connection,
    note_uid: str,
    user_uid: str,
) -> None:
    """Remove the saved state row for ``(note_uid, user_uid)``.

    No-op when no row exists. Used by future cleanup paths (e.g. when
    a note is deleted in the canvas).
    """
    await conn.execute(
        "DELETE FROM mini_app_state WHERE note_uid = $1 AND user_uid = $2",
        note_uid,
        user_uid,
    )
