"""Share-link mint / list / revoke / preview operations.

Thin wrapper around [graph_share_link](../store/postgres/graph_share_link.py)
postgres helpers; the wrapper layer holds policy (token generation,
expected role values) so the postgres layer stays pure SQL.
"""

import secrets

from typing import Literal

import asyncpg

from topix.store.postgres import graph_share_link as gsl

ShareRole = Literal["member", "viewer"]


async def mint_link(
    conn: asyncpg.Connection,
    *,
    graph_uid: str,
    role: ShareRole,
    created_by_uid: str,
) -> str:
    """Generate + persist a new share link. Returns the opaque token."""
    if role not in ("member", "viewer"):
        raise ValueError(f"Invalid share-link role: {role}")
    token = secrets.token_urlsafe(32)
    await gsl.insert_share_link(
        conn,
        token=token,
        graph_uid=graph_uid,
        role=role,
        created_by_uid=created_by_uid,
    )
    return token


async def list_active_links(
    conn: asyncpg.Connection, *, graph_uid: str,
) -> list[dict]:
    """Return active share links for a board, newest first."""
    return await gsl.list_active_links_for_graph(conn, graph_uid=graph_uid)


async def revoke(
    conn: asyncpg.Connection, *, graph_uid: str, token: str,
) -> bool:
    """Soft-revoke one link. Returns True if the link existed and was active."""
    return await gsl.revoke_link(conn, token=token, graph_uid=graph_uid)


async def revoke_all(
    conn: asyncpg.Connection, *, graph_uid: str,
) -> int:
    """Soft-revoke every active link on the board; returns the count revoked."""
    return await gsl.revoke_all_links_for_graph(conn, graph_uid=graph_uid)


async def preview(
    conn: asyncpg.Connection, *, token: str,
) -> dict | None:
    """Look up what a token grants, without consuming it.

    Returns `{graph_uid, role}` if the link is active, `None` otherwise.
    Safe to expose pre-auth on the `/share/<token>/preview` endpoint so
    the landing page can render an "X invited you to ..." preview before
    a sign-up commitment.
    """
    return await gsl.get_active_link(conn, token=token)
