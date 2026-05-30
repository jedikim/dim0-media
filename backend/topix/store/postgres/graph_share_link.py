"""Postgres helpers for the graph_share_link table.

Mirrors the pattern of [graph_user.py](graph_user.py): all functions
take `(conn, …, *_uid)` and translate uids to integer ids internally.
The `token` itself is the primary key — opaque random text, generated
via `secrets.token_urlsafe(32)` by the caller.
"""

import asyncpg

from topix.store.postgres.graph import get_graph_id_by_uid
from topix.store.postgres.user import get_user_id_by_uid


async def insert_share_link(
    conn: asyncpg.Connection,
    *,
    token: str,
    graph_uid: str,
    role: str,
    created_by_uid: str,
) -> None:
    """Persist a newly-minted share link. Raises if graph/user uid is unknown."""
    graph_id = await get_graph_id_by_uid(conn, graph_uid)
    user_id = await get_user_id_by_uid(conn, created_by_uid)
    if graph_id is None or user_id is None:
        raise ValueError(
            "Invalid graph_uid or user_uid: "
            f"graph_uid={graph_uid}, user_uid={created_by_uid}"
        )
    await conn.execute(
        "INSERT INTO graph_share_link (token, graph_id, role, created_by) "
        "VALUES ($1, $2, $3, $4)",
        token, graph_id, role, user_id,
    )


async def get_active_link(
    conn: asyncpg.Connection, *, token: str,
) -> dict | None:
    """Look up an unrevoked link by token.

    Returns a dict with `(graph_uid, role)` or `None` when the token
    is unknown or revoked.
    """
    row = await conn.fetchrow(
        "SELECT g.uid AS graph_uid, l.role "
        "FROM graph_share_link l JOIN graphs g ON g.id = l.graph_id "
        "WHERE l.token = $1 AND l.revoked_at IS NULL",
        token,
    )
    if row is None:
        return None
    return {"graph_uid": row["graph_uid"], "role": row["role"]}


async def list_active_links_for_graph(
    conn: asyncpg.Connection, *, graph_uid: str,
) -> list[dict]:
    """Return active share links for a board, newest first."""
    graph_id = await get_graph_id_by_uid(conn, graph_uid)
    if graph_id is None:
        return []
    rows = await conn.fetch(
        "SELECT token, role, created_at "
        "FROM graph_share_link "
        "WHERE graph_id = $1 AND revoked_at IS NULL "
        "ORDER BY created_at DESC",
        graph_id,
    )
    return [
        {
            "token": row["token"],
            "role": row["role"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        }
        for row in rows
    ]


async def revoke_link(
    conn: asyncpg.Connection, *, token: str, graph_uid: str,
) -> bool:
    """Soft-revoke a link. Returns True if a row was updated.

    Scoped to `graph_uid` so the owner-side endpoint can guard against
    revoking a token from a different board (defense in depth — the
    endpoint also checks ownership).
    """
    graph_id = await get_graph_id_by_uid(conn, graph_uid)
    if graph_id is None:
        return False
    result = await conn.execute(
        "UPDATE graph_share_link SET revoked_at = NOW() "
        "WHERE token = $1 AND graph_id = $2 AND revoked_at IS NULL",
        token, graph_id,
    )
    return result.endswith(" 0") is False


async def revoke_all_links_for_graph(
    conn: asyncpg.Connection, *, graph_uid: str,
) -> int:
    """Revoke every active link for the board; returns the count revoked."""
    graph_id = await get_graph_id_by_uid(conn, graph_uid)
    if graph_id is None:
        return 0
    result = await conn.execute(
        "UPDATE graph_share_link SET revoked_at = NOW() "
        "WHERE graph_id = $1 AND revoked_at IS NULL",
        graph_id,
    )
    return int(result.split()[-1])
