"""Share-link acceptance — turns an invitation into a membership.

The accept flow is *upgrade-only*: an existing owner who clicks a
viewer link stays an owner; a viewer who clicks a member link is
upgraded. Never downgrades — see sharing-archi.md decision 2026-05-28.
"""

import logging

import asyncpg

from topix.sharing import links
from topix.store.postgres.graph_user import (
    add_user_to_graph_by_uid,
    get_graph_role_by_user_uid,
)
from topix.store.postgres.user import get_user_id_by_uid

logger = logging.getLogger(__name__)


# Role precedence — higher wins on accept.
_ROLE_RANK = {"viewer": 1, "member": 2, "owner": 3}


def _wins(candidate: str, existing: str | None) -> bool:
    """Return True iff `candidate` strictly outranks `existing`."""
    if existing is None:
        return True
    return _ROLE_RANK.get(candidate, 0) > _ROLE_RANK.get(existing, 0)


async def accept_link(
    conn: asyncpg.Connection,
    *,
    token: str,
    user_uid: str,
) -> dict | None:
    """Consume a share link for the given signed-in user.

    Returns `{graph_uid, role, already_member}` on success, `None` if
    the token is unknown or revoked.

    Semantics:
      - If the user has no row in `graph_user` for the board, insert
        one with the link's role. `already_member=False`.
      - If they have a row with a HIGHER role (e.g. owner), no change.
        `already_member=True` and `role` is the *existing* (higher) role.
      - If they have a row with a LOWER role (viewer clicks member link),
        upgrade the row. `already_member=True`, `role` is the new role.
      - If they have a row with the SAME role, no change. `already_member=True`.

    The link itself is NOT revoked on consume — it remains reusable until
    the owner explicitly revokes it. Different users may click the same
    link and each become a member of the board.
    """
    info = await links.preview(conn, token=token)
    if info is None:
        return None
    graph_uid = info["graph_uid"]
    incoming_role = info["role"]

    existing_role = await get_graph_role_by_user_uid(conn, graph_uid, user_uid)

    if existing_role is None:
        # First-time accept — insert membership at the link's role.
        await add_user_to_graph_by_uid(
            conn, graph_uid=graph_uid, user_uid=user_uid, role=incoming_role,
        )
        logger.info(
            "share-link accept user=%s board=%s role=%s (new member)",
            user_uid, graph_uid, incoming_role,
        )
        return {
            "graph_uid": graph_uid,
            "role": incoming_role,
            "already_member": False,
        }

    if _wins(incoming_role, existing_role):
        # Upgrade in place — same UNIQUE row, change the role column.
        user_id = await get_user_id_by_uid(conn, user_uid)
        # graph_id already validated by add_user_to_graph_by_uid;
        # safe to do a direct UPDATE here.
        await conn.execute(
            "UPDATE graph_user SET role = $1 "
            "WHERE graph_id = (SELECT id FROM graphs WHERE uid = $2) "
            "AND user_id = $3",
            incoming_role, graph_uid, user_id,
        )
        logger.info(
            "share-link accept user=%s board=%s upgrade %s -> %s",
            user_uid, graph_uid, existing_role, incoming_role,
        )
        return {
            "graph_uid": graph_uid,
            "role": incoming_role,
            "already_member": True,
        }

    # Existing role outranks or matches — no change.
    logger.info(
        "share-link accept user=%s board=%s no-op (existing %s >= incoming %s)",
        user_uid, graph_uid, existing_role, incoming_role,
    )
    return {
        "graph_uid": graph_uid,
        "role": existing_role,
        "already_member": True,
    }
