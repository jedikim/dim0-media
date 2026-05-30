"""Graph User Base Postgres Store."""
import asyncpg

from topix.datatypes.graph.graph import Graph
from topix.store.postgres.graph import get_graph_id_by_uid
from topix.store.postgres.user import get_user_id_by_uid


async def add_user_to_graph_by_uid(
    conn: asyncpg.Connection,
    graph_uid: str,
    user_uid: str,
    role: str,
) -> bool:
    """Associate a user (by uid) to a graph (by uid) with a role.

    Returns True if added, False if already exists.
    """
    graph_id = await get_graph_id_by_uid(conn, graph_uid)
    user_id = await get_user_id_by_uid(conn, user_uid)
    if graph_id is None or user_id is None:
        raise ValueError(
            "Invalid graph_uid or user_uid: "
            f"graph_uid={graph_uid}, user_uid={user_uid}"
        )

    select_query = (
        "SELECT 1 FROM graph_user WHERE graph_id = $1 AND user_id = $2"
    )
    insert_query = (
        "INSERT INTO graph_user (graph_id, user_id, role) VALUES ($1, $2, $3)"
    )

    exists = await conn.fetchval(select_query, graph_id, user_id)
    if exists:
        return False

    await conn.execute(insert_query, graph_id, user_id, role)
    return True


async def list_graphs_by_user_uid(
    conn: asyncpg.Connection,
    user_uid: str
) -> list[tuple[Graph, str, str | None]]:
    """List every board the user can access; one row per (board, user).

    Returns a tuple per row: `(graph, role, owner_email)`.
      - `role` is the user's role on that board ("owner" | "member" | "viewer").
      - `owner_email` is the email of the board's owner, or `None` if the
         board has no owner row (shouldn't happen but defensive).

    Used by the sidebar's "My boards" / "Shared with me" split — the
    role discriminator drives the bucketing, and owner_email surfaces
    in the tooltip on shared rows.
    """
    user_id = await get_user_id_by_uid(conn, user_uid)
    if user_id is None:
        return []

    # Self-join to also pull the OWNER's email per row. LEFT JOIN so a
    # board with a missing owner row still shows up (defensive).
    query = (
        "SELECT g.id, g.uid, g.label, g.readonly, g.thumbnail, "
        "       g.created_at, g.updated_at, g.deleted_at, "
        "       gu.role AS user_role, "
        "       owner_u.email AS owner_email "
        "FROM graph_user gu JOIN graphs g ON gu.graph_id = g.id "
        "LEFT JOIN graph_user owner_gu "
        "  ON owner_gu.graph_id = g.id AND owner_gu.role = 'owner' "
        "LEFT JOIN users owner_u ON owner_u.id = owner_gu.user_id "
        "WHERE gu.user_id = $1 "
        "AND g.deleted_at IS NULL "
        "ORDER BY COALESCE(g.updated_at, g.created_at) DESC"
    )
    rows = await conn.fetch(query, user_id)

    return [
        (
            Graph(
                id=row['id'],
                uid=row['uid'],
                label=row['label'],
                readonly=row['readonly'],
                thumbnail=row['thumbnail'],
                created_at=row['created_at'].isoformat() if row['created_at'] else None,
                updated_at=row['updated_at'].isoformat() if row['updated_at'] else None,
                deleted_at=row['deleted_at'].isoformat() if row['deleted_at'] else None,
            ),
            row['user_role'],
            row['owner_email'],
        )
        for row in rows
    ]


async def list_users_by_graph_uid(
    conn: asyncpg.Connection,
    graph_uid: str
):
    """Return list of (user_uid, role) for all users having access to this graph."""
    graph_id = await get_graph_id_by_uid(conn, graph_uid)
    if graph_id is None:
        return []

    query = (
        "SELECT u.uid, gu.role "
        "FROM graph_user gu JOIN users u ON gu.user_id = u.id "
        "WHERE gu.graph_id = $1"
    )
    rows = await conn.fetch(query, graph_id)

    # List of tuples (user_uid, role)
    return [(row['uid'], row['role']) for row in rows]


async def get_graph_role_by_user_uid(
    conn: asyncpg.Connection,
    graph_uid: str,
    user_uid: str,
) -> str | None:
    """Return user's role for a graph, or None when no access exists."""
    graph_id = await get_graph_id_by_uid(conn, graph_uid)
    user_id = await get_user_id_by_uid(conn, user_uid)
    if graph_id is None or user_id is None:
        return None

    query = (
        "SELECT role FROM graph_user "
        "WHERE graph_id = $1 AND user_id = $2"
    )
    return await conn.fetchval(query, graph_id, user_id)


async def list_members_for_graph(
    conn: asyncpg.Connection,
    graph_uid: str,
) -> list[dict]:
    """Return the members of a board for the owner's "People with access" UI.

    Ordered owner → member → viewer, alphabetical by email within each
    group. Each row carries `(user_uid, email, role, joined_at)`.
    """
    rows = await conn.fetch(
        "SELECT u.uid AS user_uid, u.email, gu.role, gu.created_at AS joined_at "
        "FROM graph_user gu "
        "JOIN users u ON u.id = gu.user_id "
        "JOIN graphs g ON g.id = gu.graph_id "
        "WHERE g.uid = $1 "
        "ORDER BY "
        " CASE gu.role WHEN 'owner' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, "
        " LOWER(u.email)",
        graph_uid,
    )
    return [
        {
            "user_uid": row["user_uid"],
            "email": row["email"],
            "role": row["role"],
            "joined_at": row["joined_at"].isoformat() if row["joined_at"] else None,
        }
        for row in rows
    ]


async def get_owner_uid_by_graph_uid(
    conn: asyncpg.Connection,
    graph_uid: str,
) -> str | None:
    """Return the user_uid of the owner of `graph_uid`, or None if none.

    Single-statement join so the WS-side capacity check (which calls
    this synchronously inside the ticket-mint endpoint) doesn't pay
    two round-trips.
    """
    row = await conn.fetchrow(
        "SELECT u.uid "
        "FROM graph_user gu JOIN users u ON gu.user_id = u.id "
        "WHERE gu.graph_id = (SELECT id FROM graphs WHERE uid = $1) "
        "AND gu.role = 'owner' LIMIT 1",
        graph_uid,
    )
    return row["uid"] if row else None


async def remove_user_from_graph_by_uid(
    conn: asyncpg.Connection,
    user_uid: str,
    graph_uid: str
) -> int:
    """Remove a user (by uid) from a graph's access list.

    Returns number of rows deleted (0 or 1).
    """
    user_id = await get_user_id_by_uid(conn, user_uid)
    graph_id = await get_graph_id_by_uid(conn, graph_uid)
    if user_id is None or graph_id is None:
        return 0

    query = (
        "DELETE FROM graph_user WHERE user_id = $1 AND graph_id = $2"
    )
    result = await conn.execute(query, user_id, graph_id)
    # asyncpg returns "DELETE N" where N is the number of rows deleted
    return int(result.split()[-1])
