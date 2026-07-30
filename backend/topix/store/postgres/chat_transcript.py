"""Browser-agent chat transcript helpers.

For synced boards whose chat runs on the in-browser engine, the client is the
source of truth. The server stores and returns the transcript verbatim (an
opaque JSON array of client messages) — there is no server-side chat model, no
embedding. Used for backup and cross-device seed only.

JSON serialization is done in Python (``json.dumps``/``json.loads``) rather than
via an asyncpg codec, so this module doesn't impose a JSONB codec on the shared
pool (mirrors ``mini_app_state``).
"""

from __future__ import annotations

import json

from typing import Any

import asyncpg


async def upsert_transcript(
    conn: asyncpg.Connection,
    chat_uid: str,
    user_uid: str,
    board_id: str | None,
    label: str | None,
    transcript: Any,
) -> None:
    """Insert or replace the whole transcript for ``(chat_uid, user_uid)``.

    ``transcript`` is any JSON-serializable value (the client's message array).
    The previous value is overwritten — the client always sends the full turn
    history, so there is no merge. A non-null ``label`` never regresses to null.
    """
    await conn.execute(
        "INSERT INTO chat_transcript "
        "(chat_uid, user_uid, board_id, label, transcript, updated_at) "
        "VALUES ($1, $2, $3, $4, $5::jsonb, NOW()) "
        "ON CONFLICT (chat_uid, user_uid) DO UPDATE SET "
        "    board_id = EXCLUDED.board_id, "
        "    label = COALESCE(EXCLUDED.label, chat_transcript.label), "
        "    transcript = EXCLUDED.transcript, "
        "    updated_at = NOW()",
        chat_uid,
        user_uid,
        board_id,
        label,
        json.dumps(transcript),
    )


async def list_transcripts_by_board(
    conn: asyncpg.Connection,
    user_uid: str,
    board_id: str,
) -> list[dict[str, Any]]:
    """Return this user's transcripts for ``board_id``, most-recent first.

    Each item is ``{chat_uid, label, transcript, updated_at}`` with the
    transcript decoded to its native Python value. Empty list when none exist.
    """
    rows = await conn.fetch(
        "SELECT chat_uid, label, transcript, updated_at FROM chat_transcript "
        "WHERE user_uid = $1 AND board_id = $2 "
        "ORDER BY updated_at DESC",
        user_uid,
        board_id,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        raw = row["transcript"]
        # asyncpg returns JSONB as raw JSON text by default; decode here.
        transcript = json.loads(raw) if isinstance(raw, str) else raw
        updated_at = row["updated_at"]
        out.append(
            {
                "chat_uid": row["chat_uid"],
                "label": row["label"],
                "transcript": transcript,
                "updated_at": updated_at.isoformat() if updated_at else None,
            }
        )
    return out
